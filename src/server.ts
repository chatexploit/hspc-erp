
import "dotenv/config";

import express, {
  Request,
  Response,
  NextFunction
} from "express";

import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { PrismaClient } from "@prisma/client";

import path from "path";

const app = express();

const prisma = new PrismaClient();

const PORT =
  Number(process.env.PORT || 5000);

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "HSPC-development-secret";

const PUBLIC_DIR =
  path.join(process.cwd(), "public");

app.use(
  helmet({
    crossOriginResourcePolicy: {
      policy: "cross-origin"
    }
  })
);

app.use(cors());

app.use(
  express.json({
    limit: "1mb"
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

app.use(morgan("combined"));

app.use(
  express.static(PUBLIC_DIR)
);

interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    fullName: string;
    role: string;
  };
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function auth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {

  const header =
    req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {

    return res.status(401).json({
      message: "Authentication required."
    });

  }

  const token =
    header.substring(7);

  try {

    req.user =
      jwt.verify(
        token,
        JWT_SECRET
      ) as AuthRequest["user"];

    next();

  } catch {

    return res.status(401).json({
      message: "Invalid or expired token."
    });

  }

}

/* ============================================================
   HEALTH
============================================================ */

app.get(
  "/api/health",
  async (
    _req,
    res
  ) => {

    await prisma.$queryRaw`
      SELECT 1
    `;

    res.json({
      ok: true,
      service: "HSPC ERP",
      status: "online"
    });

  }
);

/* ============================================================
   LOGIN
============================================================ */

app.post(
  "/api/login",
  async (
    req,
    res
  ) => {

    try {

      const username =
        clean(
          req.body?.username
        );

      const password =
        String(
          req.body?.password ?? ""
        );

      if (
        !username ||
        !password
      ) {

        return res.status(400).json({
          message:
            "Username and password are required."
        });

      }

      const user =
        await prisma.user.findUnique({
          where: {
            username
          }
        });

      if (!user) {

        return res.status(401).json({
          message:
            "Invalid username or password."
        });

      }

      const valid =
        await bcrypt.compare(
          password,
          user.passwordHash
        );

      if (!valid) {

        return res.status(401).json({
          message:
            "Invalid username or password."
        });

      }

      const payload = {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        role: user.role
      };

      const token =
        jwt.sign(
          payload,
          JWT_SECRET,
          {
            expiresIn: "7d"
          }
        );

      res.json({
        token,
        username: user.username,
        fullName: user.fullName,
        role: user.role
      });

    } catch (error) {

      console.error(
        "LOGIN ERROR:",
        error
      );

      res.status(500).json({
        message:
          "Login service error."
      });

    }

  }
);

/* ============================================================
   CURRENT USER
============================================================ */

app.get(
  "/api/me",
  auth,
  async (
    req: AuthRequest,
    res
  ) => {

    const user =
      await prisma.user.findUnique({
        where: {
          id: req.user!.id
        },
        select: {
          id: true,
          username: true,
          fullName: true,
          role: true,
          createdAt: true
        }
      });

    if (!user) {

      return res.status(404).json({
        message: "User not found."
      });

    }

    res.json({
      user
    });

  }
);

/* ============================================================
   DASHBOARD
============================================================ */

app.get(
  "/api/dashboard",
  auth,
  async (
    _req,
    res
  ) => {

    const [
      customers,
      jobs,
      invoices,
      payments
    ] = await Promise.all([
      prisma.customer.count(),

      prisma.job.count(),

      prisma.invoice.findMany({
        include: {
          payments: true
        }
      }),

      prisma.payment.findMany()
    ]);

    const revenue =
      payments.reduce(
        (sum, payment) =>
          sum +
          Number(
            payment.amountPaid
          ),
        0
      );

    const outstanding =
      invoices.reduce(
        (sum, invoice) => {

          const paid =
            invoice.payments.reduce(
              (p, payment) =>
                p +
                Number(
                  payment.amountPaid
                ),
              0
            );

          return (
            sum +
            Math.max(
              0,
              Number(
                invoice.amountDue
              ) - paid
            )
          );

        },
        0
      );

    res.json({

      stats: {
        customers,
        jobs,
        invoices: invoices.length,
        payments: payments.length,
        revenue,
        outstanding
      }

    });

  }
);

/* ============================================================
   CUSTOMERS
============================================================ */

app.get(
  "/api/customers",
  auth,
  async (
    _req,
    res
  ) => {

    const customers =
      await prisma.customer.findMany({
        orderBy: {
          createdAt: "desc"
        },
        include: {
          jobs: {
            select: {
              id: true
            }
          }
        }
      });

    res.json({
      customers
    });

  }
);

app.post(
  "/api/customers",
  auth,
  async (
    req,
    res
  ) => {

    const name =
      clean(req.body?.name);

    const phone =
      clean(req.body?.phone);

    const email =
      clean(req.body?.email);

    const address =
      clean(req.body?.address);

    const gstin =
      clean(req.body?.gstin);

    if (
      !name ||
      !phone
    ) {

      return res.status(400).json({
        message:
          "Name and phone are required."
      });

    }

    const existing =
      await prisma.customer.findUnique({
        where: {
          phone
        }
      });

    if (existing) {

      return res.status(409).json({
        message:
          "A customer with this phone number already exists."
      });

    }

    const customer =
      await prisma.customer.create({
        data: {
          name,
          phone,
          email: email || null,
          address: address || null,
          gstin: gstin || null
        }
      });

    res.status(201).json({
      customer
    });

  }
);

/* ============================================================
   JOBS
============================================================ */

app.get(
  "/api/jobs",
  auth,
  async (
    _req,
    res
  ) => {

    const jobs =
      await prisma.job.findMany({
        orderBy: {
          createdAt: "desc"
        },
        include: {
          customer: true
        }
      });

    res.json({
      jobs
    });

  }
);

app.post(
  "/api/jobs",
  auth,
  async (
    req,
    res
  ) => {

    const jobCode =
      clean(
        req.body?.jobCode
      );

    const customerId =
      clean(
        req.body?.customerId
      );

    const serviceType =
      clean(
        req.body?.serviceType
      );

    if (
      !jobCode ||
      !customerId ||
      !serviceType
    ) {

      return res.status(400).json({
        message:
          "Job code, customer and service are required."
      });

    }

    const job =
      await prisma.job.create({
        data: {
          jobCode,
          customerId,
          serviceType,
          status:
            clean(
              req.body?.status
            ) ||
            "SCHEDULED",
          scheduledDate:
            req.body?.scheduledDate
              ? new Date(
                  req.body.scheduledDate
                )
              : null,
          totalAmount:
            Number(
              req.body?.totalAmount || 0
            ),
          notes:
            clean(
              req.body?.notes
            ) || null
        },
        include: {
          customer: true
        }
      });

    res.status(201).json({
      job
    });

  }
);

/* ============================================================
   INVOICES
============================================================ */

app.get(
  "/api/invoices",
  auth,
  async (
    _req,
    res
  ) => {

    const invoices =
      await prisma.invoice.findMany({
        orderBy: {
          issueDate: "desc"
        },
        include: {
          job: {
            include: {
              customer: true
            }
          },
          payments: true
        }
      });

    res.json({
      invoices
    });

  }
);

app.post(
  "/api/invoices",
  auth,
  async (
    req,
    res
  ) => {

    const invoiceNumber =
      clean(
        req.body?.invoiceNumber
      );

    const jobId =
      clean(
        req.body?.jobId
      );

    const amountDue =
      Number(
        req.body?.amountDue || 0
      );

    if (
      !invoiceNumber ||
      !jobId
    ) {

      return res.status(400).json({
        message:
          "Invoice number and job are required."
      });

    }

    const invoice =
      await prisma.invoice.create({
        data: {
          invoiceNumber,
          jobId,
          amountDue,
          subtotal:
            Number(
              req.body?.subtotal || amountDue
            ),
          discount:
            Number(
              req.body?.discount || 0
            ),
          tax:
            Number(
              req.body?.tax || 0
            ),
          status:
            "UNPAID"
        },
        include: {
          job: {
            include: {
              customer: true
            }
          }
        }
      });

    res.status(201).json({
      invoice
    });

  }
);

/* ============================================================
   PAYMENTS
============================================================ */

app.get(
  "/api/payments",
  auth,
  async (
    _req,
    res
  ) => {

    const payments =
      await prisma.payment.findMany({
        orderBy: {
          paymentDate: "desc"
        },
        include: {
          invoice: {
            include: {
              job: {
                include: {
                  customer: true
                }
              }
            }
          }
        }
      });

    res.json({
      payments
    });

  }
);

app.post(
  "/api/payments",
  auth,
  async (
    req,
    res
  ) => {

    const invoiceId =
      clean(
        req.body?.invoiceId
      );

    const amountPaid =
      Number(
        req.body?.amountPaid || 0
      );

    const paymentMethod =
      clean(
        req.body?.paymentMethod
      );

    if (
      !invoiceId ||
      amountPaid <= 0 ||
      !paymentMethod
    ) {

      return res.status(400).json({
        message:
          "Invoice, payment amount and payment method are required."
      });

    }

    const payment =
      await prisma.payment.create({
        data: {
          invoiceId,
          amountPaid,
          paymentMethod,
          referenceNumber:
            clean(
              req.body?.referenceNumber
            ) || null
        }
      });

    const invoice =
      await prisma.invoice.findUnique({
        where: {
          id: invoiceId
        },
        include: {
          payments: true
        }
      });

    if (invoice) {

      const paid =
        invoice.payments.reduce(
          (sum, item) =>
            sum +
            Number(
              item.amountPaid
            ),
          0
        );

      let status =
        "PARTIAL";

      if (
        paid >=
        Number(
          invoice.amountDue
        )
      ) {
        status = "PAID";
      }

      await prisma.invoice.update({
        where: {
          id: invoice.id
        },
        data: {
          status
        }
      });

    }

    res.status(201).json({
      payment
    });

  }
);

/* ============================================================
   API 404
============================================================ */

app.use(
  "/api",
  (
    _req,
    res
  ) => {

    res.status(404).json({
      message:
        "HSPC API endpoint not found."
    });

  }
);

/* ============================================================
   FRONTEND
============================================================ */

app.get(
  "*",
  (
    _req,
    res
  ) => {

    res.sendFile(
      path.join(
        PUBLIC_DIR,
        "index.html"
      )
    );

  }
);

/* ============================================================
   ERROR HANDLER
============================================================ */

app.use(
  (
    error: any,
    _req: Request,
    res: Response,
    _next: NextFunction
  ) => {

    console.error(
      "HSPC ERROR:",
      error
    );

    if (
      error?.code ===
      "P2002"
    ) {

      return res.status(409).json({
        message:
          "A unique value already exists."
      });

    }

    res.status(500).json({
      message:
        "Internal HSPC ERP error."
    });

  }
);

/* ============================================================
   ADMIN SEED
============================================================ */

async function seedAdmin(){

  const existing =
    await prisma.user.findFirst({
      where: {
        role: "ADMIN"
      }
    });

  if (existing) {

    console.log(
      `✓ Admin found: ${existing.username}`
    );

    return;

  }

  const username =
    process.env.DEFAULT_ADMIN_USERNAME ||
    "admin";

  const password =
    process.env.DEFAULT_ADMIN_PASSWORD ||
    "admin123";

  const fullName =
    process.env.DEFAULT_ADMIN_NAME ||
    "HSPC Administrator";

  const passwordHash =
    await bcrypt.hash(
      password,
      12
    );

  await prisma.user.create({
    data: {
      username,
      passwordHash,
      fullName,
      role: "ADMIN"
    }
  });

  console.log(
    `✓ Admin created: ${username}`
  );

}

/* ============================================================
   START
============================================================ */

async function start(){

  try {

    await prisma.$connect();

    console.log(
      "✓ Prisma / SQLite connected."
    );

    await seedAdmin();

    app.listen(
      PORT,
      "0.0.0.0",
      () => {

        console.log(
          `🚀 HSPC ERP running on port ${PORT}`
        );

      }
    );

  } catch(error){

    console.error(
      "✖ HSPC startup failed:",
      error
    );

    process.exit(1);

  }

}

start();

