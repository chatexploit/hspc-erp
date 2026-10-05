import express, { NextFunction, Request, Response, RequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

dotenv.config();

const prisma = new PrismaClient();
const app = express();

const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_SECRET";
const PUBLIC_DIR = path.resolve(__dirname, "../public");
const BACKUP_DIR = path.resolve(__dirname, "../backups");

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "3mb" }));
app.use(morgan("combined"));
app.use(express.static(PUBLIC_DIR));

type AuthUser = {
  sub: string;
  username: string;
  name: string;
  role: string;
  branchId?: string | null;
};

type AuthRequest = Request & {
  user?: AuthUser;
};

const asyncRoute = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler => {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
};

function currentUser(req: Request): AuthUser {
  return (req as AuthRequest).user as AuthUser;
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    (req as AuthRequest).user = decoded;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function allowRoles(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    const user = currentUser(req);
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

function text(value: unknown, fallback = ""): string {
  return value === undefined || value === null ? fallback : String(value).trim();
}

function number(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function date(value: unknown): Date | undefined {
  if (!value) return undefined;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dateRequired(value: unknown): Date {
  const d = date(value);
  if (!d) throw new Error("Invalid date");
  return d;
}

function makeNumber(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

async function audit(
  req: Request,
  action: string,
  entity: string,
  entityId?: string,
  details?: unknown
): Promise<void> {
  const user = (req as AuthRequest).user;
  await prisma.auditLog.create({
    data: {
      userId: user?.sub,
      action,
      entity,
      entityId,
      details: typeof details === "string" ? details : JSON.stringify(details ?? {}),
      ipAddress: clientIp(req)
    }
  });
}

async function settingsMap(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((x) => [x.key, x.value]));
}

function statusFromPayment(total: number, paid: number): string {
  if (paid <= 0) return total <= 0 ? "PAID" : "DUE";
  if (paid >= total - 0.005) return "PAID";
  return "PARTIAL";
}

type LineInput = {
  productId?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  unitCost?: number;
  discount?: number;
  taxRate?: number;
  batchNumber?: string;
  expiryDate?: string;
  batchId?: string;
};

type CalculatedLine = {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  total: number;
};

async function prepareLines(items: LineInput[], purchase = false): Promise<CalculatedLine[]> {
  const output: CalculatedLine[] = [];

  for (const raw of items || []) {
    const product = raw.productId
      ? await prisma.product.findUnique({ where: { id: String(raw.productId) } })
      : null;

    const quantity = number(raw.quantity, 1);
    const price = purchase
      ? number(raw.unitCost ?? raw.unitPrice ?? product?.purchasePrice ?? 0)
      : number(raw.unitPrice ?? product?.sellingPrice ?? 0);

    const discount = Math.max(0, number(raw.discount));
    const taxRate = Math.max(0, number(raw.taxRate ?? product?.taxRate ?? 18));
    const gross = quantity * price;
    const total = Math.max(0, gross - discount);

    output.push({
      productId: raw.productId ? String(raw.productId) : undefined,
      description: text(raw.description, product?.name || "Service"),
      quantity,
      unitPrice: price,
      discount,
      taxRate,
      total
    });
  }

  return output;
}

function calculateTotals(
  lines: CalculatedLine[],
  invoiceDiscount = 0,
  sameState = true
): {
  subtotal: number;
  discount: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  tax: number;
  total: number;
} {
  const subtotal = lines.reduce((s, x) => s + x.quantity * x.unitPrice, 0);
  const lineDiscount = lines.reduce((s, x) => s + x.discount, 0);
  const before = Math.max(0, subtotal - lineDiscount);
  const docDiscount = Math.max(0, Math.min(invoiceDiscount, before));
  const taxable = Math.max(0, before - docDiscount);
  const ratio = before > 0 ? taxable / before : 0;
  const tax = lines.reduce((s, x) => s + x.total * x.taxRate / 100, 0) * ratio;

  return {
    subtotal,
    discount: lineDiscount + docDiscount,
    taxable,
    cgst: sameState ? tax / 2 : 0,
    sgst: sameState ? tax / 2 : 0,
    igst: sameState ? 0 : tax,
    tax,
    total: taxable + tax
  };
}

async function createBatchIfNeeded(
  productId: string,
  batchNumber: string,
  expiryDate?: unknown,
  quantity = 0,
  purchaseCost = 0,
  sellingPrice = 0
): Promise<string | undefined> {
  if (!batchNumber) return undefined;

  const existing = await prisma.batch.findFirst({
    where: { productId, batchNumber }
  });

  if (existing) {
    const updated = await prisma.batch.update({
      where: { id: existing.id },
      data: {
        quantity: { increment: quantity },
        expiryDate: date(expiryDate) || existing.expiryDate,
        purchaseCost,
        sellingPrice
      }
    });
    return updated.id;
  }

  const created = await prisma.batch.create({
    data: {
      productId,
      batchNumber,
      expiryDate: date(expiryDate),
      quantity,
      purchaseCost,
      sellingPrice
    }
  });

  return created.id;
}

// ------------------------------------------------------------
// HEALTH / AUTH
// ------------------------------------------------------------

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "HSPC ERP", status: "online" });
});

app.post(
  "/api/login",
  asyncRoute(async (req, res) => {
    const username = text(req.body?.username || req.body?.email).toLowerCase();
    const password = text(req.body?.password);

    if (!username || !password) {
      res.status(400).json({ error: "Username and password are required" });
      return;
    }

    const user = await prisma.user.findUnique({ where: { username } });

    if (!user || user.status !== "ACTIVE") {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);

    if (!valid) {
      res.status(401).json({ error: "Invalid username or password" });
      return;
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });

    const payload: AuthUser = {
      sub: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      branchId: user.branchId
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "LOGIN",
        entity: "User",
        entityId: user.id,
        ipAddress: clientIp(req)
      }
    });

    res.json({ token, user: payload });
  })
);

app.get("/api/me", requireAuth, (req, res) => {
  res.json({ user: currentUser(req) });
});

app.post(
  "/api/change-password",
  requireAuth,
  asyncRoute(async (req, res) => {
    const user = currentUser(req);
    const currentPassword = text(req.body?.currentPassword);
    const newPassword = text(req.body?.newPassword);

    if (newPassword.length < 6) {
      res.status(400).json({ error: "New password must contain at least 6 characters" });
      return;
    }

    const dbUser = await prisma.user.findUnique({ where: { id: user.sub } });

    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const valid = await bcrypt.compare(currentPassword, dbUser.passwordHash);

    if (!valid) {
      res.status(400).json({ error: "Current password is incorrect" });
      return;
    }

    await prisma.user.update({
      where: { id: user.sub },
      data: {
        passwordHash: await bcrypt.hash(newPassword, 12),
        mustChangePassword: false
      }
    });

    await audit(req, "PASSWORD_CHANGE", "User", user.sub);
    res.json({ ok: true });
  })
);

// ------------------------------------------------------------
// BOOTSTRAP
// ------------------------------------------------------------

app.get(
  "/api/bootstrap",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const [
      customers,
      users,
      employees,
      products,
      suppliers,
      branches,
      settings
    ] = await Promise.all([
      prisma.customer.findMany({ orderBy: { name: "asc" }, take: 500 }),
      prisma.user.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          username: true,
          name: true,
          role: true,
          phone: true,
          branchId: true,
          status: true
        },
        orderBy: { name: "asc" }
      }),
      prisma.employee.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
      prisma.product.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
      prisma.supplier.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
      prisma.branch.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
      settingsMap()
    ]);

    res.json({ customers, users, employees, products, suppliers, branches, settings });
  })
);

// ------------------------------------------------------------
// SIMPLE CRUD
// ------------------------------------------------------------

type CrudConfig = {
  path: string;
  delegate: string;
  fields: string[];
  searchFields?: string[];
  dateFields?: string[];
  numberFields?: string[];
  integerFields?: string[];
  booleanFields?: string[];
  roles?: string[];
  softDelete?: boolean;
};

const simpleConfigs: CrudConfig[] = [
  {
    path: "branches",
    delegate: "branch",
    fields: ["code", "name", "phone", "email", "address", "city", "state", "pincode", "gstin", "status"],
    searchFields: ["name", "code", "city"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"]
  },
  {
    path: "customers",
    delegate: "customer",
    fields: [
      "customerCode",
      "name",
      "type",
      "phone",
      "alternatePhone",
      "email",
      "gstin",
      "contactPerson",
      "address",
      "city",
      "state",
      "pincode",
      "source",
      "notes",
      "status"
    ],
    searchFields: ["name", "phone", "customerCode", "gstin", "city"]
  },
  {
    path: "suppliers",
    delegate: "supplier",
    fields: [
      "supplierCode",
      "name",
      "contactPerson",
      "phone",
      "email",
      "gstin",
      "address",
      "city",
      "state",
      "pincode",
      "paymentTerms",
      "notes",
      "status"
    ],
    searchFields: ["name", "phone", "supplierCode", "gstin"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"]
  },
  {
    path: "products",
    delegate: "product",
    fields: [
      "sku",
      "name",
      "category",
      "productType",
      "unit",
      "brand",
      "hsn",
      "taxRate",
      "purchasePrice",
      "sellingPrice",
      "currentStock",
      "minStock",
      "maxStock",
      "description",
      "status"
    ],
    searchFields: ["name", "sku", "category", "brand"],
    numberFields: ["taxRate", "purchasePrice", "sellingPrice", "currentStock", "minStock", "maxStock"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"]
  },
  {
    path: "expenses",
    delegate: "expense",
    fields: [
      "expenseNumber",
      "category",
      "description",
      "amount",
      "paymentMethod",
      "supplierId",
      "employeeId",
      "expenseDate",
      "notes"
    ],
    searchFields: ["expenseNumber", "category", "description"],
    dateFields: ["expenseDate"],
    numberFields: ["amount"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"]
  },
  {
    path: "employees",
    delegate: "employee",
    fields: [
      "employeeCode",
      "userId",
      "name",
      "designation",
      "department",
      "phone",
      "email",
      "address",
      "joinDate",
      "employmentType",
      "basicSalary",
      "allowances",
      "standardDeduction",
      "status"
    ],
    searchFields: ["employeeCode", "name", "designation", "department", "phone"],
    dateFields: ["joinDate"],
    numberFields: ["basicSalary", "allowances", "standardDeduction"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "HR"]
  },
  {
    path: "attendance",
    delegate: "attendance",
    fields: ["employeeId", "date", "status", "checkIn", "checkOut", "hours", "notes"],
    searchFields: ["employeeId", "status"],
    dateFields: ["date", "checkIn", "checkOut"],
    numberFields: ["hours"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "HR"]
  },
  {
    path: "leaves",
    delegate: "leave",
    fields: ["employeeId", "leaveType", "startDate", "endDate", "days", "reason", "status"],
    searchFields: ["employeeId", "leaveType", "status"],
    dateFields: ["startDate", "endDate"],
    numberFields: ["days"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "HR"]
  },
  {
    path: "advances",
    delegate: "employeeAdvance",
    fields: ["employeeId", "amount", "advanceDate", "reason", "status", "notes"],
    searchFields: ["employeeId", "reason", "status"],
    dateFields: ["advanceDate"],
    numberFields: ["amount"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "HR", "ACCOUNTANT"]
  },
  {
    path: "vehicles",
    delegate: "vehicle",
    fields: [
      "vehicleNumber",
      "vehicleType",
      "make",
      "model",
      "year",
      "driverId",
      "currentOdometer",
      "insuranceExpiry",
      "pollutionExpiry",
      "fitnessExpiry",
      "lastServiceDate",
      "status",
      "notes"
    ],
    searchFields: ["vehicleNumber", "make", "model", "vehicleType"],
    dateFields: ["insuranceExpiry", "pollutionExpiry", "fitnessExpiry", "lastServiceDate"],
    numberFields: ["currentOdometer"],
    integerFields: ["year"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"]
  },
  {
    path: "fuel",
    delegate: "fuelLog",
    fields: [
      "vehicleId",
      "date",
      "litres",
      "amount",
      "odometer",
      "fuelType",
      "station",
      "notes"
    ],
    searchFields: ["vehicleId", "fuelType", "station"],
    dateFields: ["date"],
    numberFields: ["litres", "amount", "odometer"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"]
  },
  {
    path: "maintenance",
    delegate: "vehicleMaintenance",
    fields: [
      "vehicleId",
      "date",
      "maintenanceType",
      "description",
      "amount",
      "odometer",
      "vendor",
      "nextServiceDate",
      "status",
      "notes"
    ],
    searchFields: ["vehicleId", "maintenanceType", "vendor", "status"],
    dateFields: ["date", "nextServiceDate"],
    numberFields: ["amount", "odometer"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER"]
  },
  {
    path: "followups",
    delegate: "followUp",
    fields: [
      "customerId",
      "jobId",
      "assignedTo",
      "title",
      "dueDate",
      "priority",
      "status",
      "notes"
    ],
    searchFields: ["title", "priority", "status"],
    dateFields: ["dueDate"],
    roles: ["SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"]
  }
];

function normalizeCrudData(config: CrudConfig, body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const field of config.fields) {
    if (body[field] === undefined) continue;

    if ((config.dateFields || []).includes(field)) {
      const parsed = date(body[field]);
      if (parsed) data[field] = parsed;
      continue;
    }

    if ((config.numberFields || []).includes(field)) {
      data[field] = number(body[field]);
      continue;
    }

    if ((config.integerFields || []).includes(field)) {
      data[field] = Math.trunc(number(body[field]));
      continue;
    }

    if ((config.booleanFields || []).includes(field)) {
      data[field] = Boolean(body[field]);
      continue;
    }

    data[field] = typeof body[field] === "string" ? text(body[field]) : body[field];
  }

  return data;
}

for (const config of simpleConfigs) {
  const rolesMiddleware = config.roles?.length ? [requireAuth, allowRoles(...config.roles)] : [requireAuth];

  app.get(
    `/api/${config.path}`,
    ...rolesMiddleware,
    asyncRoute(async (req, res) => {
      const prismaAny = prisma as any;
      const q = text(req.query.q);
      const where: Record<string, unknown> = {};

      if (q && config.searchFields?.length) {
        where.OR = config.searchFields.map((field) => ({
          [field]: { contains: q }
        }));
      }

      const rows = await prismaAny[config.delegate].findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 500
      });

      res.json(rows);
    })
  );

  app.post(
    `/api/${config.path}`,
    ...rolesMiddleware,
    asyncRoute(async (req, res) => {
      const prismaAny = prisma as any;
      const user = currentUser(req);
      const data = normalizeCrudData(config, req.body || {});

      if ("branchId" in (prismaAny[config.delegate] as object)) {
        data.branchId = user.branchId || undefined;
      }

      if (config.path === "customers" && !text(data.customerCode)) {
        data.customerCode = makeNumber("CUS");
      }

      if (config.path === "suppliers" && !text(data.supplierCode)) {
        data.supplierCode = makeNumber("SUP");
      }

      if (config.path === "products" && !text(data.sku)) {
        data.sku = makeNumber("SKU");
      }

      if (config.path === "expenses") {
        data.expenseNumber = text(data.expenseNumber) || makeNumber("EXP");
        data.createdBy = user.sub;
        data.branchId = user.branchId || undefined;
      }

      if (config.path === "employees" && !text(data.employeeCode)) {
        data.employeeCode = makeNumber("EMP");
      }

      if (config.path === "vehicles") {
        data.vehicleNumber = text(data.vehicleNumber).toUpperCase();
      }

      const created = await prismaAny[config.delegate].create({ data });
      await audit(req, "CREATE", config.delegate, created.id, data);

      res.status(201).json(created);
    })
  );

  app.put(
    `/api/${config.path}/:id`,
    ...rolesMiddleware,
    asyncRoute(async (req, res) => {
      const prismaAny = prisma as any;
      const id = String(req.params.id);
      const data = normalizeCrudData(config, req.body || {});
      const updated = await prismaAny[config.delegate].update({
        where: { id },
        data
      });

      await audit(req, "UPDATE", config.delegate, id, data);
      res.json(updated);
    })
  );

  app.delete(
    `/api/${config.path}/:id`,
    ...rolesMiddleware,
    asyncRoute(async (req, res) => {
      const prismaAny = prisma as any;
      const id = String(req.params.id);

      if (config.softDelete !== false) {
        const updated = await prismaAny[config.delegate].update({
          where: { id },
          data: { status: "INACTIVE" }
        }).catch(async () => {
          return prismaAny[config.delegate].delete({ where: { id } });
        });

        await audit(req, "DELETE", config.delegate, id);
        res.json(updated);
        return;
      }

      const deleted = await prismaAny[config.delegate].delete({ where: { id } });
      await audit(req, "DELETE", config.delegate, id);
      res.json(deleted);
    })
  );
}

// ------------------------------------------------------------
// USERS
// ------------------------------------------------------------

app.get(
  "/api/users",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  asyncRoute(async (_req, res) => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        branchId: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });

    res.json(users);
  })
);

app.post(
  "/api/users",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN"),
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const username = text(body.username).toLowerCase();
    const password = text(body.password);

    if (!username || password.length < 6 || !text(body.name)) {
      res.status(400).json({ error: "Username, name and password of at least 6 characters are required" });
      return;
    }

    const created = await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(password, 12),
        name: text(body.name),
        email: text(body.email) || null,
        phone: text(body.phone) || null,
        role: text(body.role, "STAFF").toUpperCase(),
        branchId: text(body.branchId) || null,
        status: text(body.status, "ACTIVE"),
        mustChangePassword: Boolean(body.mustChangePassword)
      }
    });

    await audit(req, "CREATE", "User", created.id, { username, role: created.role });

    res.status(201).json({
      id: created.id,
      username: created.username,
      name: created.name,
      email: created.email,
      phone: created.phone,
      role: created.role,
      branchId: created.branchId,
      status: created.status
    });
  })
);

app.put(
  "/api/users/:id",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN"),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const body = req.body || {};
    const data: Record<string, unknown> = {
      name: text(body.name),
      email: text(body.email) || null,
      phone: text(body.phone) || null,
      role: text(body.role, "STAFF").toUpperCase(),
      branchId: text(body.branchId) || null,
      status: text(body.status, "ACTIVE")
    };

    if (text(body.password)) {
      data.passwordHash = await bcrypt.hash(text(body.password), 12);
      data.mustChangePassword = true;
    }

    const updated = await prisma.user.update({ where: { id }, data });
    await audit(req, "UPDATE", "User", id, data);

    res.json({
      id: updated.id,
      username: updated.username,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      role: updated.role,
      branchId: updated.branchId,
      status: updated.status
    });
  })
);

// ------------------------------------------------------------
// CUSTOMER DETAIL
// ------------------------------------------------------------

app.get(
  "/api/customers/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const customer = await prisma.customer.findUnique({ where: { id } });

    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const [jobs, contracts, followups, invoices] = await Promise.all([
      prisma.job.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.contract.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.followUp.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.invoice.findMany({ where: { customerId: id }, orderBy: { issueDate: "desc" }, take: 100 })
    ]);

    const invoiceIds = invoices.map((x) => x.id);

    const payments = invoiceIds.length
      ? await prisma.payment.findMany({
          where: { invoiceId: { in: invoiceIds } },
          orderBy: { receivedAt: "desc" }
        })
      : [];

    res.json({ customer, jobs, contracts, followups, invoices, payments });
  })
);

// ------------------------------------------------------------
// CONTRACTS
// ------------------------------------------------------------

app.get(
  "/api/contracts",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const rows = await prisma.contract.findMany({
      orderBy: { createdAt: "desc" },
      take: 500
    });
    res.json(rows);
  })
);

app.post(
  "/api/contracts",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"),
  asyncRoute(async (req, res) => {
    const body = req.body || {};

    const created = await prisma.contract.create({
      data: {
        contractNumber: text(body.contractNumber) || makeNumber("AMC"),
        customerId: text(body.customerId),
        serviceType: text(body.serviceType, "GENERAL PEST CONTROL"),
        frequency: text(body.frequency, "MONTHLY"),
        recurrenceMonths: Math.max(1, Math.trunc(number(body.recurrenceMonths, 1))),
        startDate: date(body.startDate),
        endDate: date(body.endDate),
        nextServiceDate: date(body.nextServiceDate || body.startDate),
        amount: number(body.amount),
        address: text(body.address) || null,
        inclusions: text(body.inclusions) || null,
        notes: text(body.notes) || null,
        status: text(body.status, "ACTIVE"),
        branchId: currentUser(req).branchId || null
      }
    });

    await audit(req, "CREATE", "Contract", created.id, created);
    res.status(201).json(created);
  })
);

app.put(
  "/api/contracts/:id",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const body = req.body || {};

    const updated = await prisma.contract.update({
      where: { id },
      data: {
        customerId: text(body.customerId),
        serviceType: text(body.serviceType),
        frequency: text(body.frequency),
        recurrenceMonths: Math.max(1, Math.trunc(number(body.recurrenceMonths, 1))),
        startDate: date(body.startDate),
        endDate: date(body.endDate),
        nextServiceDate: date(body.nextServiceDate),
        amount: number(body.amount),
        address: text(body.address) || null,
        inclusions: text(body.inclusions) || null,
        notes: text(body.notes) || null,
        status: text(body.status, "ACTIVE")
      }
    });

    await audit(req, "UPDATE", "Contract", id, body);
    res.json(updated);
  })
);

app.post(
  "/api/contracts/:id/generate-job",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const contract = await prisma.contract.findUnique({ where: { id } });

    if (!contract) {
      res.status(404).json({ error: "Contract not found" });
      return;
    }

    const customer = await prisma.customer.findUnique({
      where: { id: contract.customerId }
    });

    if (!customer) {
      res.status(400).json({ error: "Contract customer not found" });
      return;
    }

    const job = await prisma.job.create({
      data: {
        jobNumber: makeNumber("JOB"),
        customerId: contract.customerId,
        contractId: contract.id,
        serviceType: contract.serviceType,
        address: contract.address || customer.address || null,
        scheduledStart: contract.nextServiceDate || new Date(),
        estimatedAmount: contract.amount,
        branchId: currentUser(req).branchId || contract.branchId || null,
        status: "SCHEDULED",
        notes: `Generated from ${contract.contractNumber}`
      }
    });

    const months = Math.max(1, contract.recurrenceMonths);
    const next = new Date(contract.nextServiceDate || new Date());
    next.setMonth(next.getMonth() + months);

    await prisma.contract.update({
      where: { id: contract.id },
      data: { nextServiceDate: next }
    });

    await audit(req, "GENERATE_JOB", "Contract", id, { jobId: job.id });
    res.status(201).json(job);
  })
);

// ------------------------------------------------------------
// JOBS
// ------------------------------------------------------------

app.get(
  "/api/jobs",
  requireAuth,
  asyncRoute(async (req, res) => {
    const q = text(req.query.q);
    const status = text(req.query.status);

    const jobs = await prisma.job.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q
          ? {
              OR: [
                { jobNumber: { contains: q } },
                { serviceType: { contains: q } },
                { address: { contains: q } }
              ]
            }
          : {})
      },
      orderBy: { scheduledStart: "desc" },
      take: 500
    });

    res.json(jobs);
  })
);

app.post(
  "/api/jobs",
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const user = currentUser(req);

    const created = await prisma.job.create({
      data: {
        jobNumber: text(body.jobNumber) || makeNumber("JOB"),
        customerId: text(body.customerId),
        contractId: text(body.contractId) || null,
        serviceType: text(body.serviceType, "PEST CONTROL"),
        priority: text(body.priority, "NORMAL"),
        address: text(body.address) || null,
        scheduledStart: date(body.scheduledStart),
        scheduledEnd: date(body.scheduledEnd),
        technicianId: text(body.technicianId) || null,
        supervisorId: text(body.supervisorId) || null,
        status: text(body.status, "SCHEDULED").toUpperCase(),
        estimatedAmount: number(body.estimatedAmount),
        actualAmount: number(body.actualAmount),
        notes: text(body.notes) || null,
        customerNote: text(body.customerNote) || null,
        technicianNote: text(body.technicianNote) || null,
        branchId: user.branchId || null
      }
    });

    await audit(req, "CREATE", "Job", created.id, created);
    res.status(201).json(created);
  })
);

app.put(
  "/api/jobs/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const body = req.body || {};

    const updated = await prisma.job.update({
      where: { id },
      data: {
        customerId: text(body.customerId),
        contractId: text(body.contractId) || null,
        serviceType: text(body.serviceType),
        priority: text(body.priority, "NORMAL"),
        address: text(body.address) || null,
        scheduledStart: date(body.scheduledStart),
        scheduledEnd: date(body.scheduledEnd),
        technicianId: text(body.technicianId) || null,
        supervisorId: text(body.supervisorId) || null,
        status: text(body.status, "SCHEDULED").toUpperCase(),
        estimatedAmount: number(body.estimatedAmount),
        actualAmount: number(body.actualAmount),
        notes: text(body.notes) || null,
        customerNote: text(body.customerNote) || null,
        technicianNote: text(body.technicianNote) || null
      }
    });

    await audit(req, "UPDATE", "Job", id, body);
    res.json(updated);
  })
);

app.get(
  "/api/jobs/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const [customer, usage, invoices, followups] = await Promise.all([
      prisma.customer.findUnique({ where: { id: job.customerId } }),
      prisma.jobUsage.findMany({ where: { jobId: id }, orderBy: { createdAt: "desc" } }),
      prisma.invoice.findMany({ where: { jobId: id }, orderBy: { issueDate: "desc" } }),
      prisma.followUp.findMany({ where: { jobId: id }, orderBy: { createdAt: "desc" } })
    ]);

    res.json({ job, customer, usage, invoices, followups });
  })
);

app.post(
  "/api/jobs/:id/complete",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const body = req.body || {};

    const updated = await prisma.job.update({
      where: { id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        actualAmount: number(body.actualAmount)
      }
    });

    await audit(req, "COMPLETE", "Job", id, body);
    res.json(updated);
  })
);

app.post(
  "/api/jobs/:id/usage",
  requireAuth,
  asyncRoute(async (req, res) => {
    const jobId = String(req.params.id);
    const productId = text(req.body?.productId);
    const qty = number(req.body?.quantity);

    if (!productId || qty <= 0) {
      res.status(400).json({ error: "Product and positive quantity are required" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });

      if (!product) throw new Error("Product not found");
      if (product.currentStock < qty) throw new Error(`Insufficient stock for ${product.name}`);

      const newStock = product.currentStock - qty;

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: { currentStock: newStock }
      });

      const usage = await tx.jobUsage.create({
        data: {
          jobId,
          productId,
          batchId: text(req.body?.batchId) || null,
          quantity: qty,
          unitCost: product.purchasePrice,
          totalCost: qty * product.purchasePrice,
          notes: text(req.body?.notes) || null
        }
      });

      await tx.stockTxn.create({
        data: {
          productId,
          batchId: text(req.body?.batchId) || null,
          type: "JOB_USAGE",
          quantity: -qty,
          balance: newStock,
          unitCost: product.purchasePrice,
          reference: `JOB:${jobId}`,
          jobId,
          createdBy: currentUser(req).sub
        }
      });

      return { updatedProduct, usage };
    });

    await audit(req, "STOCK_OUT", "JobUsage", result.usage.id, result.usage);
    res.status(201).json(result);
  })
);

// ------------------------------------------------------------
// STOCK
// ------------------------------------------------------------

app.get(
  "/api/inventory/transactions",
  requireAuth,
  asyncRoute(async (req, res) => {
    const productId = text(req.query.productId);

    const rows = await prisma.stockTxn.findMany({
      where: productId ? { productId } : {},
      orderBy: { createdAt: "desc" },
      take: 500
    });

    res.json(rows);
  })
);

app.get(
  "/api/inventory/expiring",
  requireAuth,
  asyncRoute(async (req, res) => {
    const days = Math.max(1, Math.min(365, Math.trunc(number(req.query.days, 30))));
    const until = new Date();
    until.setDate(until.getDate() + days);

    const rows = await prisma.batch.findMany({
      where: {
        expiryDate: {
          gte: new Date(),
          lte: until
        },
        quantity: { gt: 0 },
        status: "ACTIVE"
      },
      orderBy: { expiryDate: "asc" }
    });

    res.json(rows);
  })
);

app.post(
  "/api/stock/adjust",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "STAFF"),
  asyncRoute(async (req, res) => {
    const productId = text(req.body?.productId);
    const qty = number(req.body?.quantity);

    if (!productId || qty === 0) {
      res.status(400).json({ error: "Product and non-zero quantity are required" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });
      if (!product) throw new Error("Product not found");

      const newStock = product.currentStock + qty;

      if (newStock < 0) {
        throw new Error("Stock cannot become negative");
      }

      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: { currentStock: newStock }
      });

      const txn = await tx.stockTxn.create({
        data: {
          productId,
          batchId: text(req.body?.batchId) || null,
          type: qty > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT",
          quantity: qty,
          balance: newStock,
          unitCost: product.purchasePrice,
          reference: text(req.body?.reference) || "MANUAL",
          notes: text(req.body?.notes) || null,
          createdBy: currentUser(req).sub
        }
      });

      return { updatedProduct, txn };
    });

    await audit(req, "STOCK_ADJUSTMENT", "Product", productId, req.body);
    res.json(result);
  })
);

// ------------------------------------------------------------
// PURCHASE ORDERS
// ------------------------------------------------------------

app.get(
  "/api/purchase-orders",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const rows = await prisma.purchaseOrder.findMany({
      orderBy: { createdAt: "desc" },
      take: 500
    });

    const output = await Promise.all(
      rows.map(async (po) => ({
        ...po,
        items: await prisma.purchaseOrderItem.findMany({
          where: { purchaseOrderId: po.id }
        })
      }))
    );

    res.json(output);
  })
);

app.post(
  "/api/purchase-orders",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"),
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const lines = await prepareLines(Array.isArray(body.items) ? body.items : [], true);
    const discount = number(body.discount);

    const subtotal = lines.reduce((s, x) => s + x.quantity * x.unitPrice, 0);
    const lineDiscount = lines.reduce((s, x) => s + x.discount, 0);
    const taxableBefore = Math.max(0, subtotal - lineDiscount);
    const totalDiscount = Math.min(taxableBefore, lineDiscount + discount);
    const taxable = Math.max(0, subtotal - totalDiscount);
    const tax = lines.reduce((s, x) => s + x.total * x.taxRate / 100, 0);
    const total = taxable + tax;

    const po = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          poNumber: text(body.poNumber) || makeNumber("PO"),
          supplierId: text(body.supplierId),
          orderDate: date(body.orderDate) || new Date(),
          expectedDate: date(body.expectedDate),
          status: text(body.status, "DRAFT").toUpperCase(),
          subtotal,
          discount: totalDiscount,
          tax,
          total,
          notes: text(body.notes) || null,
          branchId: currentUser(req).branchId || null
        }
      });

      for (const line of lines) {
        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: created.id,
            productId: String(line.productId || ""),
            quantity: line.quantity,
            unitCost: line.unitPrice,
            discount: line.discount,
            taxRate: line.taxRate,
            total: line.total
          }
        });
      }

      return created;
    });

    await audit(req, "CREATE", "PurchaseOrder", po.id, po);
    res.status(201).json(po);
  })
);

app.post(
  "/api/purchase-orders/:id/receive",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"),
  asyncRoute(async (req, res) => {
    const poId = String(req.params.id);
    const po = await prisma.purchaseOrder.findUnique({ where: { id: poId } });

    if (!po) {
      res.status(404).json({ error: "Purchase order not found" });
      return;
    }

    if (po.status === "RECEIVED") {
      res.status(400).json({ error: "Purchase order already received" });
      return;
    }

    const sourceItems = await prisma.purchaseOrderItem.findMany({
      where: { purchaseOrderId: poId }
    });

    const bodyItems: LineInput[] = Array.isArray(req.body?.items) ? req.body.items : [];

    const items: LineInput[] =
      bodyItems.length > 0
        ? bodyItems
        : sourceItems.map((x) => ({
            productId: x.productId,
            quantity: x.quantity,
            unitCost: x.unitCost,
            discount: x.discount,
            taxRate: x.taxRate
          }));

    const lines = await prepareLines(items, true);

    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          purchaseNumber: makeNumber("PUR"),
          purchaseOrderId: poId,
          supplierId: po.supplierId,
          invoiceNumber: text(req.body?.invoiceNumber) || null,
          receivedDate: date(req.body?.receivedDate) || new Date(),
          subtotal: po.subtotal,
          discount: po.discount,
          tax: po.tax,
          total: po.total,
          paymentStatus: text(req.body?.paymentStatus, "UNPAID"),
          notes: text(req.body?.notes) || null,
          branchId: currentUser(req).branchId || null
        }
      });

      for (const raw of items) {
        const productId = String(raw.productId || "");
        if (!productId) continue;

        const product = await tx.product.findUnique({ where: { id: productId } });
        if (!product) continue;

        const quantity = number(raw.quantity);
        const unitCost = number(raw.unitCost ?? product.purchasePrice);
        const sellingPrice = product.sellingPrice;
        const batchNumber = text(raw.batchNumber);
        const existingBatch = batchNumber
          ? await tx.batch.findFirst({ where: { productId, batchNumber } })
          : null;

        let batchId: string | null = null;

        if (existingBatch) {
          const updatedBatch = await tx.batch.update({
            where: { id: existingBatch.id },
            data: {
              quantity: { increment: quantity },
              expiryDate: date(raw.expiryDate) || existingBatch.expiryDate
            }
          });
          batchId = updatedBatch.id;
        } else if (batchNumber) {
          const newBatch = await tx.batch.create({
            data: {
              productId,
              batchNumber,
              expiryDate: date(raw.expiryDate),
              quantity,
              purchaseCost: unitCost,
              sellingPrice
            }
          });
          batchId = newBatch.id;
        }

        const newStock = product.currentStock + quantity;

        await tx.product.update({
          where: { id: productId },
          data: {
            currentStock: newStock,
            purchasePrice: unitCost
          }
        });

        await tx.purchaseItem.create({
          data: {
            purchaseId: created.id,
            productId,
            batchId,
            quantity,
            unitCost,
            discount: number(raw.discount),
            taxRate: number(raw.taxRate ?? product.taxRate),
            total: quantity * unitCost - number(raw.discount)
          }
        });

        await tx.stockTxn.create({
          data: {
            productId,
            batchId,
            type: "PURCHASE_RECEIPT",
            quantity,
            balance: newStock,
            unitCost,
            reference: `PURCHASE:${created.purchaseNumber}`,
            purchaseId: created.id,
            createdBy: currentUser(req).sub
          }
        });
      }

      await tx.purchaseOrder.update({
        where: { id: poId },
        data: { status: "RECEIVED" }
      });

      return created;
    });

    await audit(req, "RECEIVE", "PurchaseOrder", poId, {
      purchaseId: purchase.id
    });

    res.status(201).json(purchase);
  })
);


app.post(
  "/api/purchases",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"),
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const supplierId = text(body.supplierId);
    const items = Array.isArray(body.items) ? body.items as LineInput[] : [];

    if (!supplierId) {
      res.status(400).json({ error: "Supplier is required" });
      return;
    }

    if (!items.length) {
      res.status(400).json({ error: "At least one purchase item is required" });
      return;
    }

    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId }
    });

    if (!supplier) {
      res.status(400).json({ error: "Supplier not found" });
      return;
    }

    const lines = await prepareLines(items, true);

    if (!lines.length) {
      res.status(400).json({ error: "No valid purchase items" });
      return;
    }

    const subtotal = lines.reduce(
      (sum, line) => sum + line.quantity * line.unitPrice,
      0
    );

    const discount = lines.reduce(
      (sum, line) => sum + line.discount,
      0
    );

    const taxable = Math.max(0, subtotal - discount);

    const tax = lines.reduce(
      (sum, line) => sum + (line.total * line.taxRate / 100),
      0
    );

    const total = taxable + tax;

    const purchase = await prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          purchaseNumber: makeNumber("PUR"),
          supplierId,
          invoiceNumber: text(body.invoiceNumber) || null,
          receivedDate: date(body.receivedDate) || new Date(),
          subtotal,
          discount,
          tax,
          total,
          paymentStatus: text(body.paymentStatus, "UNPAID"),
          notes: text(body.notes) || null,
          branchId: currentUser(req).branchId || null
        }
      });

      for (const raw of items) {
        const productId = text(raw.productId);

        if (!productId) {
          throw new Error("Every purchase line must have a product");
        }

        const product = await tx.product.findUnique({
          where: { id: productId }
        });

        if (!product) {
          throw new Error(`Product not found: ${productId}`);
        }

        const quantity = number(raw.quantity);

        if (quantity <= 0) {
          throw new Error(`Invalid quantity for ${product.name}`);
        }

        const unitCost = number(
          raw.unitCost ?? raw.unitPrice ?? product.purchasePrice
        );

        const discountAmount = Math.max(0, number(raw.discount));
        const taxRate = Math.max(
          0,
          number(raw.taxRate ?? product.taxRate)
        );

        const lineTotal =
          Math.max(0, quantity * unitCost - discountAmount);

        let batchId: string | null = null;
        const batchNumber = text(raw.batchNumber);

        if (batchNumber) {
          const existingBatch = await tx.batch.findFirst({
            where: {
              productId,
              batchNumber
            }
          });

          if (existingBatch) {
            const updatedBatch = await tx.batch.update({
              where: { id: existingBatch.id },
              data: {
                quantity: { increment: quantity },
                expiryDate:
                  date(raw.expiryDate) || existingBatch.expiryDate,
                purchaseCost: unitCost
              }
            });

            batchId = updatedBatch.id;
          } else {
            const newBatch = await tx.batch.create({
              data: {
                productId,
                batchNumber,
                expiryDate: date(raw.expiryDate),
                quantity,
                purchaseCost: unitCost,
                sellingPrice: product.sellingPrice
              }
            });

            batchId = newBatch.id;
          }
        }

        const newStock = product.currentStock + quantity;

        await tx.product.update({
          where: { id: productId },
          data: {
            currentStock: newStock,
            purchasePrice: unitCost
          }
        });

        await tx.purchaseItem.create({
          data: {
            purchaseId: created.id,
            productId,
            batchId,
            quantity,
            unitCost,
            discount: discountAmount,
            taxRate,
            total: lineTotal
          }
        });

        await tx.stockTxn.create({
          data: {
            productId,
            batchId,
            type: "PURCHASE_RECEIPT",
            quantity,
            balance: newStock,
            unitCost,
            reference: `PURCHASE:${created.purchaseNumber}`,
            purchaseId: created.id,
            notes: "Direct purchase receipt",
            createdBy: currentUser(req).sub
          }
        });
      }

      return created;
    });

    await audit(
      req,
      "CREATE",
      "Purchase",
      purchase.id,
      purchase
    );

    res.status(201).json(purchase);
  })
);

// ------------------------------------------------------------
// PURCHASES
// ------------------------------------------------------------

app.get(
  "/api/purchases",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"),
  asyncRoute(async (_req, res) => {
    const rows = await prisma.purchase.findMany({
      orderBy: { createdAt: "desc" },
      take: 500
    });

    const output = await Promise.all(
      rows.map(async (x) => ({
        ...x,
        items: await prisma.purchaseItem.findMany({
          where: { purchaseId: x.id }
        })
      }))
    );

    res.json(output);
  })
);

// ------------------------------------------------------------
// QUOTATIONS
// ------------------------------------------------------------

app.get(
  "/api/quotations",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const rows = await prisma.quotation.findMany({
      orderBy: { createdAt: "desc" },
      take: 500
    });

    const output = await Promise.all(
      rows.map(async (x) => ({
        ...x,
        items: await prisma.quotationItem.findMany({
          where: { quotationId: x.id }
        })
      }))
    );

    res.json(output);
  })
);

app.post(
  "/api/quotations",
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const customerId = text(body.customerId);

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      res.status(400).json({ error: "Customer not found" });
      return;
    }

    const lines = await prepareLines(Array.isArray(body.items) ? body.items : []);
    const company = await settingsMap();
    const sameState =
      !customer.state ||
      !company.companyState ||
      customer.state.toLowerCase() === company.companyState.toLowerCase();

    const totals = calculateTotals(lines, number(body.discount), sameState);

    const quotation = await prisma.$transaction(async (tx) => {
      const q = await tx.quotation.create({
        data: {
          quotationNumber: text(body.quotationNumber) || makeNumber("QUO"),
          customerId,
          quoteDate: date(body.quoteDate) || new Date(),
          validUntil: date(body.validUntil),
          status: text(body.status, "DRAFT"),
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxable: totals.taxable,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          total: totals.total,
          notes: text(body.notes) || null,
          terms: text(body.terms) || null,
          branchId: currentUser(req).branchId || null
        }
      });

      for (const line of lines) {
        await tx.quotationItem.create({
          data: {
            quotationId: q.id,
            productId: line.productId || null,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            taxRate: line.taxRate,
            total: line.total
          }
        });
      }

      return q;
    });

    await audit(req, "CREATE", "Quotation", quotation.id, quotation);
    res.status(201).json(quotation);
  })
);

app.post(
  "/api/quotations/:id/convert",
  requireAuth,
  asyncRoute(async (req, res) => {
    const quotationId = String(req.params.id);
    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId }
    });

    if (!quotation) {
      res.status(404).json({ error: "Quotation not found" });
      return;
    }

    const existing = await prisma.invoice.findFirst({
      where: { quotationId }
    });

    if (existing) {
      res.json(existing);
      return;
    }

    const items = await prisma.quotationItem.findMany({
      where: { quotationId }
    });

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          invoiceNumber: makeNumber("INV"),
          customerId: quotation.customerId,
          quotationId,
          issueDate: new Date(),
          status: "DUE",
          subtotal: quotation.subtotal,
          discount: quotation.discount,
          taxable: quotation.taxable,
          cgst: quotation.cgst,
          sgst: quotation.sgst,
          igst: quotation.igst,
          total: quotation.total,
          paidAmount: 0,
          balance: quotation.total,
          notes: quotation.notes,
          terms: quotation.terms,
          branchId: quotation.branchId
        }
      });

      for (const item of items) {
        await tx.invoiceItem.create({
          data: {
            invoiceId: created.id,
            productId: item.productId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxRate: item.taxRate,
            total: item.total
          }
        });
      }

      await tx.quotation.update({
        where: { id: quotationId },
        data: { status: "CONVERTED" }
      });

      return created;
    });

    await audit(req, "CONVERT", "Quotation", quotationId, {
      invoiceId: invoice.id
    });

    res.status(201).json(invoice);
  })
);

// ------------------------------------------------------------
// INVOICES
// ------------------------------------------------------------

app.get(
  "/api/invoices",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const rows = await prisma.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 500
    });

    const output = await Promise.all(
      rows.map(async (x) => ({
        ...x,
        items: await prisma.invoiceItem.findMany({
          where: { invoiceId: x.id }
        })
      }))
    );

    res.json(output);
  })
);

app.get(
  "/api/invoices/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);
    const invoice = await prisma.invoice.findUnique({ where: { id } });

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const [items, customer, payments] = await Promise.all([
      prisma.invoiceItem.findMany({ where: { invoiceId: id } }),
      prisma.customer.findUnique({ where: { id: invoice.customerId } }),
      prisma.payment.findMany({ where: { invoiceId: id }, orderBy: { receivedAt: "asc" } })
    ]);

    res.json({ invoice, items, customer, payments });
  })
);

app.post(
  "/api/invoices",
  requireAuth,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const customerId = text(body.customerId);

    const customer = await prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      res.status(400).json({ error: "Customer not found" });
      return;
    }

    const lines = await prepareLines(Array.isArray(body.items) ? body.items : []);
    const company = await settingsMap();
    const sameState =
      !customer.state ||
      !company.companyState ||
      customer.state.toLowerCase() === company.companyState.toLowerCase();

    const totals = calculateTotals(lines, number(body.discount), sameState);

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          invoiceNumber: text(body.invoiceNumber) || makeNumber("INV"),
          customerId,
          jobId: text(body.jobId) || null,
          quotationId: text(body.quotationId) || null,
          issueDate: date(body.issueDate) || new Date(),
          dueDate: date(body.dueDate),
          status: statusFromPayment(totals.total, 0),
          subtotal: totals.subtotal,
          discount: totals.discount,
          taxable: totals.taxable,
          cgst: totals.cgst,
          sgst: totals.sgst,
          igst: totals.igst,
          total: totals.total,
          paidAmount: 0,
          balance: totals.total,
          notes: text(body.notes) || null,
          terms: text(body.terms) || null,
          branchId: currentUser(req).branchId || null
        }
      });

      for (const line of lines) {
        await tx.invoiceItem.create({
          data: {
            invoiceId: created.id,
            productId: line.productId || null,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discount: line.discount,
            taxRate: line.taxRate,
            total: line.total
          }
        });
      }

      return created;
    });

    await audit(req, "CREATE", "Invoice", invoice.id, invoice);
    res.status(201).json(invoice);
  })
);

// ------------------------------------------------------------
// PAYMENTS
// ------------------------------------------------------------

app.get(
  "/api/payments",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const rows = await prisma.payment.findMany({
      orderBy: { receivedAt: "desc" },
      take: 500
    });
    res.json(rows);
  })
);

app.post(
  "/api/payments",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "ACCOUNTANT"),
  asyncRoute(async (req, res) => {
    const invoiceId = text(req.body?.invoiceId);
    const amount = number(req.body?.amount);

    if (!invoiceId || amount <= 0) {
      res.status(400).json({ error: "Invoice and positive payment amount are required" });
      return;
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId }
    });

    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    if (amount > invoice.balance + 0.01) {
      res.status(400).json({ error: "Payment exceeds outstanding balance" });
      return;
    }

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          invoiceId,
          customerId: invoice.customerId,
          amount,
          method: text(req.body?.method, "CASH"),
          reference: text(req.body?.reference) || null,
          receivedAt: date(req.body?.receivedAt) || new Date(),
          notes: text(req.body?.notes) || null,
          receivedBy: currentUser(req).sub
        }
      });

      const paid = invoice.paidAmount + amount;
      const balance = Math.max(0, invoice.total - paid);

      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: paid,
          balance,
          status: statusFromPayment(invoice.total, paid)
        }
      });

      return created;
    });

    await audit(req, "RECEIVE", "Payment", payment.id, payment);
    res.status(201).json(payment);
  })
);

// ------------------------------------------------------------
// PAYROLL
// ------------------------------------------------------------

app.get(
  "/api/payroll",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "HR", "ACCOUNTANT"),
  asyncRoute(async (req, res) => {
    const month = req.query.month ? Math.trunc(number(req.query.month)) : undefined;
    const year = req.query.year ? Math.trunc(number(req.query.year)) : undefined;

    const rows = await prisma.payroll.findMany({
      where: {
        ...(month ? { month } : {}),
        ...(year ? { year } : {})
      },
      orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
      take: 500
    });

    res.json(rows);
  })
);

app.post(
  "/api/payroll/generate",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "HR", "ACCOUNTANT"),
  asyncRoute(async (req, res) => {
    const month = Math.max(1, Math.min(12, Math.trunc(number(req.body?.month, new Date().getMonth() + 1))));
    const year = Math.trunc(number(req.body?.year, new Date().getFullYear()));

    const employees = await prisma.employee.findMany({
      where: { status: "ACTIVE" }
    });

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const workingDays = end.getDate();

    const created: unknown[] = [];

    for (const employee of employees) {
      const attendance = await prisma.attendance.findMany({
        where: {
          employeeId: employee.id,
          date: {
            gte: start,
            lte: end
          }
        }
      });

      const presentDays = attendance.filter((x) =>
        ["PRESENT", "HALF_DAY", "LATE"].includes(x.status)
      ).length;

      const absentDays = attendance.filter((x) => x.status === "ABSENT").length;

      const advances = await prisma.employeeAdvance.findMany({
        where: {
          employeeId: employee.id,
          status: "OPEN",
          advanceDate: {
            lte: end
          }
        }
      });

      const advance = advances.reduce((s, x) => s + x.amount, 0);
      const deductions = employee.standardDeduction;
      const netSalary =
        employee.basicSalary +
        employee.allowances -
        deductions -
        advance;

      const existing = await prisma.payroll.findFirst({
        where: {
          employeeId: employee.id,
          month,
          year
        }
      });

      let row;

      if (existing) {
        row = await prisma.payroll.update({
          where: { id: existing.id },
          data: {
            workingDays,
            presentDays,
            absentDays,
            basicSalary: employee.basicSalary,
            allowances: employee.allowances,
            deductions,
            advance,
            netSalary
          }
        });
      } else {
        row = await prisma.payroll.create({
          data: {
            employeeId: employee.id,
            month,
            year,
            workingDays,
            presentDays,
            absentDays,
            basicSalary: employee.basicSalary,
            allowances: employee.allowances,
            overtime: 0,
            deductions,
            advance,
            netSalary,
            status: "DRAFT"
          }
        });
      }

      created.push(row);

      if (advances.length) {
        await prisma.employeeAdvance.updateMany({
          where: { id: { in: advances.map((x) => x.id) } },
          data: { status: "DEDUCTED" }
        });
      }
    }

    await audit(req, "GENERATE", "Payroll", undefined, { month, year });
    res.status(201).json(created);
  })
);

app.put(
  "/api/payroll/:id",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER", "HR", "ACCOUNTANT"),
  asyncRoute(async (req, res) => {
    const id = String(req.params.id);

    const updated = await prisma.payroll.update({
      where: { id },
      data: {
        basicSalary: number(req.body?.basicSalary),
        allowances: number(req.body?.allowances),
        overtime: number(req.body?.overtime),
        deductions: number(req.body?.deductions),
        advance: number(req.body?.advance),
        netSalary: number(req.body?.netSalary),
        status: text(req.body?.status, "DRAFT"),
        paidDate: date(req.body?.paidDate),
        notes: text(req.body?.notes) || null
      }
    });

    await audit(req, "UPDATE", "Payroll", id, req.body);
    res.json(updated);
  })
);

// ------------------------------------------------------------
// SETTINGS
// ------------------------------------------------------------

app.get(
  "/api/settings",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN", "MANAGER"),
  asyncRoute(async (_req, res) => {
    res.json(await settingsMap());
  })
);

app.put(
  "/api/settings",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN"),
  asyncRoute(async (req, res) => {
    const body = req.body || {};

    for (const [key, value] of Object.entries(body)) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(value ?? "") },
        create: { key, value: String(value ?? "") }
      });
    }

    await audit(req, "UPDATE", "Setting", undefined, body);
    res.json(await settingsMap());
  })
);

// ------------------------------------------------------------
// REPORTS
// ------------------------------------------------------------

app.get(
  "/api/reports/summary",
  requireAuth,
  asyncRoute(async (req, res) => {
    const from = date(req.query.from) || new Date(new Date().setDate(new Date().getDate() - 30));
    const to = date(req.query.to) || new Date();

    const [invoices, expenses, payroll, jobs, products, customers] = await Promise.all([
      prisma.invoice.findMany({
        where: { issueDate: { gte: from, lte: to } }
      }),
      prisma.expense.findMany({
        where: { expenseDate: { gte: from, lte: to } }
      }),
      prisma.payroll.findMany({
        where: {
          createdAt: { gte: from, lte: to }
        }
      }),
      prisma.job.findMany({
        where: {
          createdAt: { gte: from, lte: to }
        }
      }),
      prisma.product.findMany({
        where: { status: "ACTIVE" }
      }),
      prisma.customer.findMany({
        where: { status: "ACTIVE" }
      })
    ]);

    const revenue = invoices.reduce((s, x) => s + x.paidAmount, 0);
    const billed = invoices.reduce((s, x) => s + x.total, 0);
    const outstanding = invoices.reduce((s, x) => s + x.balance, 0);
    const expenseTotal = expenses.reduce((s, x) => s + x.amount, 0);
    const payrollTotal = payroll.reduce((s, x) => s + x.netSalary, 0);

    const byJobStatus: Record<string, number> = {};
    for (const job of jobs) {
      byJobStatus[job.status] = (byJobStatus[job.status] || 0) + 1;
    }

    const technicianMap: Record<string, { technicianId: string; jobs: number; revenue: number }> = {};

    for (const job of jobs) {
      if (!job.technicianId) continue;
      if (!technicianMap[job.technicianId]) {
        technicianMap[job.technicianId] = {
          technicianId: job.technicianId,
          jobs: 0,
          revenue: 0
        };
      }
      technicianMap[job.technicianId].jobs += 1;
      technicianMap[job.technicianId].revenue += job.actualAmount || job.estimatedAmount;
    }

    const lowStock = products.filter((x) => x.currentStock <= x.minStock);
    const expiringCount = await prisma.batch.count({
      where: {
        expiryDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 30 * 86400000)
        },
        quantity: { gt: 0 }
      }
    });

    res.json({
      range: { from, to },
      revenue,
      billed,
      outstanding,
      expenses: expenseTotal,
      payroll: payrollTotal,
      profit: revenue - expenseTotal - payrollTotal,
      jobs: jobs.length,
      customers: customers.length,
      lowStockCount: lowStock.length,
      expiringCount,
      jobsByStatus: byJobStatus,
      technicianPerformance: Object.values(technicianMap),
      lowStock,
      recentInvoices: invoices.sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime()).slice(0, 10),
      recentJobs: jobs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 10)
    });
  })
);

// ------------------------------------------------------------
// AUDIT / BACKUPS
// ------------------------------------------------------------

app.get(
  "/api/audit",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN"),
  asyncRoute(async (_req, res) => {
    const rows = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000
    });
    res.json(rows);
  })
);

app.post(
  "/api/backup",
  requireAuth,
  allowRoles("SUPER_ADMIN", "ADMIN"),
  asyncRoute(async (req, res) => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const stamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

    const backupPath = path.join(BACKUP_DIR, `hspc-prod-${stamp}.db`);

    await prisma.$executeRawUnsafe(
      `VACUUM INTO '${backupPath.replace(/'/g, "''")}'`
    );

    await audit(req, "BACKUP", "Database", undefined, { backupPath });

    res.json({
      ok: true,
      filename: path.basename(backupPath)
    });
  })
);

// ------------------------------------------------------------
// DASHBOARD
// ------------------------------------------------------------

app.get(
  "/api/dashboard",
  requireAuth,
  asyncRoute(async (req, res) => {
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const [customerCount, jobCount, invoiceAgg, expenseAgg, payrollAgg, outstandingAgg, lowStock] =
      await Promise.all([
        prisma.customer.count({ where: { status: "ACTIVE" } }),
        prisma.job.count({
          where: {
            createdAt: { gte: from }
          }
        }),
        prisma.invoice.aggregate({
          _sum: {
            total: true,
            paidAmount: true
          },
          where: { issueDate: { gte: from } }
        }),
        prisma.expense.aggregate({
          _sum: { amount: true },
          where: { expenseDate: { gte: from } }
        }),
        prisma.payroll.aggregate({
          _sum: { netSalary: true },
          where: { createdAt: { gte: from } }
        }),
        prisma.invoice.aggregate({
          _sum: { balance: true },
          where: { balance: { gt: 0 } }
        }),
        prisma.product.findMany({
          where: {
            status: "ACTIVE"
          },
          orderBy: { currentStock: "asc" },
          take: 10
        })
      ]);

    const filteredLowStock = lowStock.filter((x) => x.currentStock <= x.minStock);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayJobs = await prisma.job.findMany({
      where: {
        scheduledStart: {
          gte: today,
          lt: tomorrow
        }
      },
      orderBy: { scheduledStart: "asc" },
      take: 50
    });

    res.json({
      customers: customerCount,
      jobs: jobCount,
      revenue: invoiceAgg._sum.paidAmount || 0,
      billed: invoiceAgg._sum.total || 0,
      expenses: expenseAgg._sum.amount || 0,
      payroll: payrollAgg._sum.netSalary || 0,
      outstanding: outstandingAgg._sum.balance || 0,
      profit:
        (invoiceAgg._sum.paidAmount || 0) -
        (expenseAgg._sum.amount || 0) -
        (payrollAgg._sum.netSalary || 0),
      lowStock: filteredLowStock,
      todayJobs
    });
  })
);

// ------------------------------------------------------------
// ERROR / SPA FALLBACK
// ------------------------------------------------------------

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);

  const message =
    err instanceof Error ? err.message : "Internal server error";

  res.status(500).json({ error: message });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

// ------------------------------------------------------------
// SEED
// ------------------------------------------------------------

async function seed(): Promise<void> {
  const branch = await prisma.branch.upsert({
    where: { code: "HQ" },
    update: {},
    create: {
      code: "HQ",
      name: "Head Office",
      city: process.env.COMPANY_CITY || "Idukki",
      state: process.env.COMPANY_STATE || "Kerala",
      status: "ACTIVE"
    }
  });

  const settings = {
    companyName: process.env.COMPANY_NAME || "Home Safety Pest Control Service",
    companyState: process.env.COMPANY_STATE || "Kerala",
    companyCity: process.env.COMPANY_CITY || "Idukki",
    companyGSTIN: process.env.COMPANY_GSTIN || "",
    currency: "INR",
    invoicePrefix: "INV",
    quotationPrefix: "QUO",
    jobPrefix: "JOB",
    dateFormat: "DD/MM/YYYY"
  };

  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value }
    });
  }

  const username = (process.env.DEFAULT_ADMIN_EMAIL || "admin").toLowerCase();
  const existing = await prisma.user.findUnique({
    where: { username }
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(
          process.env.DEFAULT_ADMIN_PASSWORD || "admin123",
          12
        ),
        name: "System Administrator",
        email: "chat.exploit@gmail.com",
        role: "SUPER_ADMIN",
        branchId: branch.id,
        status: "ACTIVE",
        mustChangePassword: false
      }
    });
  }
}

async function main(): Promise<void> {
  await seed();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 HSPC ERP running on port ${PORT}`);
  });
}

main()
  .catch(async (err) => {
    console.error("Startup failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
