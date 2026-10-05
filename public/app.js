const token = localStorage.getItem("hspc_token");

if (!token) {
  location.href = "/login.html";
}

const state = {
  user: JSON.parse(localStorage.getItem("hspc_user") || "{}"),
  settings: {},
  customers: [],
  users: [],
  employees: [],
  products: [],
  suppliers: [],
  branches: [],
  records: {},
  page: new URLSearchParams(location.search).get("page") || "dashboard"
};

const role = () => String(state.user.role || "STAFF");

const NAV = [
  ["OPERATIONS", [
    ["dashboard", "⌂", "Dashboard", ["*"]],
    ["customers", "◉", "Customers", ["*"]],
    ["jobs", "✓", "Jobs", ["*"]],
    ["dispatch", "⇆", "Dispatch", ["*"]],
    ["schedule", "◫", "Schedule", ["*"]],
    ["contracts", "↻", "AMC / Contracts", ["*"]],
    ["followups", "◌", "Follow-ups", ["*"]]
  ]],
  ["INVENTORY & PURCHASING", [
    ["inventory", "▦", "Inventory", ["*"]],
    ["suppliers", "▣", "Suppliers", ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"]],
    ["purchase-orders", "▤", "Purchase Orders", ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"]],
    ["purchases", "□", "Receiving / Purchases", ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"]]
  ]],
  ["SALES & FINANCE", [
    ["quotations", "⌑", "Quotations", ["*"]],
    ["invoices", "₹", "Invoices", ["*"]],
    ["payments", "◈", "Payments", ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"]],
    ["expenses", "−", "Expenses", ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"]],
    ["reports", "▥", "Reports", ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"]]
  ]],
  ["PEOPLE & FLEET", [
    ["employees", "♙", "Employees", ["SUPER_ADMIN","ADMIN","MANAGER","HR"]],
    ["attendance", "◷", "Attendance", ["SUPER_ADMIN","ADMIN","MANAGER","HR"]],
    ["leaves", "↗", "Leave", ["SUPER_ADMIN","ADMIN","MANAGER","HR"]],
    ["advances", "↳", "Advances", ["SUPER_ADMIN","ADMIN","MANAGER","HR","ACCOUNTANT"]],
    ["payroll", "▤", "Payroll", ["SUPER_ADMIN","ADMIN","MANAGER","HR","ACCOUNTANT"]],
    ["vehicles", "⌁", "Vehicles", ["SUPER_ADMIN","ADMIN","MANAGER"]],
    ["fuel", "⛽", "Fuel", ["SUPER_ADMIN","ADMIN","MANAGER"]],
    ["maintenance", "⚙", "Maintenance", ["SUPER_ADMIN","ADMIN","MANAGER"]]
  ]],
  ["ADMINISTRATION", [
    ["users", "♟", "Users", ["SUPER_ADMIN","ADMIN","MANAGER"]],
    ["branches", "⌂", "Branches", ["SUPER_ADMIN","ADMIN","MANAGER"]],
    ["settings", "⚙", "Settings", ["SUPER_ADMIN","ADMIN"]],
    ["audit", "≋", "Audit Log", ["SUPER_ADMIN","ADMIN"]],
    ["backup", "⬇", "Backup", ["SUPER_ADMIN","ADMIN"]]
  ]]
];

const CONFIG = {
  customers: {
    title: "Customers",
    endpoint: "/api/customers",
    fields: [
      ["name","Customer Name","text",true],
      ["type","Type","select",true,["INDIVIDUAL","COMPANY","GOVERNMENT"]],
      ["phone","Phone","text",true],
      ["alternatePhone","Alternate Phone","text"],
      ["email","Email","email"],
      ["gstin","GSTIN","text"],
      ["contactPerson","Contact Person","text"],
      ["address","Address","textarea"],
      ["city","City","text"],
      ["state","State","text"],
      ["pincode","Pincode","text"],
      ["source","Source","select",false,["WALK_IN","REFERRAL","WEBSITE","WHATSAPP","CALL","OTHER"]],
      ["notes","Notes","textarea"],
      ["status","Status","select",false,["ACTIVE","INACTIVE"]]
    ],
    columns: ["customerCode","name","type","phone","city","status"]
  },

  jobs: {
    title:"Jobs",
    endpoint:"/api/jobs",
    lineItems:false,
    fields:[
      ["customerId","Customer","customer",true],
      ["contractId","Contract","contract"],
      ["serviceType","Service Type","select",true,["GENERAL PEST CONTROL","COCKROACH GEL","TERMITE CONTROL","RAT CONTROL","SNAKE CONTROL","MOSQUITO FOGGING","BED BUG CONTROL","TERMITE RETICULATION","AMC VISIT","OTHER"]],
      ["priority","Priority","select",false,["LOW","NORMAL","HIGH","URGENT"]],
      ["address","Service Address","textarea"],
      ["scheduledStart","Scheduled Start","datetime"],
      ["scheduledEnd","Scheduled End","datetime"],
      ["technicianId","Technician","userTechnician"],
      ["supervisorId","Supervisor","user"],
      ["status","Status","select",false,["SCHEDULED","ASSIGNED","IN_PROGRESS","COMPLETED","CANCELLED","RESCHEDULED"]],
      ["estimatedAmount","Estimated Amount","number"],
      ["actualAmount","Actual Amount","number"],
      ["customerNote","Customer Note","textarea"],
      ["technicianNote","Technician Note","textarea"],
      ["notes","Internal Notes","textarea"]
    ],
    columns:["jobNumber","customerId","serviceType","scheduledStart","technicianId","status","estimatedAmount"]
  },

  contracts:{
    title:"AMC / Contracts",
    endpoint:"/api/contracts",
    fields:[
      ["customerId","Customer","customer",true],
      ["serviceType","Service Type","select",true,["GENERAL PEST CONTROL","TERMITE CONTROL","AMC VISIT","MOSQUITO CONTROL","OTHER"]],
      ["frequency","Frequency","select",false,["MONTHLY","QUARTERLY","HALF_YEARLY","YEARLY","CUSTOM"]],
      ["recurrenceMonths","Repeat Every (Months)","number"],
      ["startDate","Start Date","date"],
      ["endDate","End Date","date"],
      ["nextServiceDate","Next Service Date","date"],
      ["amount","Contract Amount","number"],
      ["address","Service Address","textarea"],
      ["inclusions","Inclusions","textarea"],
      ["notes","Notes","textarea"],
      ["status","Status","select",false,["ACTIVE","EXPIRED","CANCELLED","ON_HOLD"]]
    ],
    columns:["contractNumber","customerId","serviceType","frequency","nextServiceDate","amount","status"]
  },

  followups:{
    title:"Follow-ups",
    endpoint:"/api/followups",
    fields:[
      ["customerId","Customer","customer",true],
      ["jobId","Job","job"],
      ["assignedTo","Assigned To","user"],
      ["title","Title","text",true],
      ["dueDate","Due Date","date"],
      ["priority","Priority","select",false,["LOW","NORMAL","HIGH","URGENT"]],
      ["status","Status","select",false,["PENDING","IN_PROGRESS","DONE","CANCELLED"]],
      ["notes","Notes","textarea"]
    ],
    columns:["title","customerId","assignedTo","dueDate","priority","status"]
  },

  suppliers:{
    title:"Suppliers",
    endpoint:"/api/suppliers",
    fields:[
      ["name","Supplier Name","text",true],
      ["contactPerson","Contact Person","text"],
      ["phone","Phone","text"],
      ["email","Email","email"],
      ["gstin","GSTIN","text"],
      ["address","Address","textarea"],
      ["city","City","text"],
      ["state","State","text"],
      ["pincode","Pincode","text"],
      ["paymentTerms","Payment Terms","text"],
      ["notes","Notes","textarea"],
      ["status","Status","select",false,["ACTIVE","INACTIVE"]]
    ],
    columns:["supplierCode","name","contactPerson","phone","gstin","status"]
  },

  products:{
    title:"Inventory",
    endpoint:"/api/products",
    fields:[
      ["sku","SKU","text"],
      ["name","Product / Chemical","text",true],
      ["category","Category","select",false,["CHEMICAL","MEDICINE","MATERIAL","EQUIPMENT","SAFETY","OFFICE","OTHER"]],
      ["productType","Product Type","select",false,["CONSUMABLE","EQUIPMENT","ASSET"]],
      ["unit","Unit","select",false,["PCS","LITRE","ML","KG","GRAM","BOX","PACK","METER","SET"]],
      ["brand","Brand","text"],
      ["hsn","HSN","text"],
      ["taxRate","GST %","number"],
      ["purchasePrice","Purchase Price","number"],
      ["sellingPrice","Selling Price","number"],
      ["currentStock","Current Stock","number"],
      ["minStock","Minimum Stock","number"],
      ["maxStock","Maximum Stock","number"],
      ["description","Description","textarea"],
      ["status","Status","select",false,["ACTIVE","INACTIVE"]]
    ],
    columns:["sku","name","category","unit","currentStock","minStock","purchasePrice","sellingPrice"]
  },

  "purchase-orders":{
    title:"Purchase Orders",
    endpoint:"/api/purchase-orders",
    lineItems:true,
    fields:[
      ["supplierId","Supplier","supplier",true],
      ["orderDate","Order Date","date"],
      ["expectedDate","Expected Date","date"],
      ["status","Status","select",false,["DRAFT","ORDERED","PARTIAL","RECEIVED","CANCELLED"]],
      ["discount","Discount","number"],
      ["notes","Notes","textarea"]
    ],
    columns:["poNumber","supplierId","orderDate","expectedDate","status","total"]
  },

  purchases:{
    title:"Receiving / Purchases",
    endpoint:"/api/purchases",
    fields:[],
    lineItems:true,
    columns:["purchaseNumber","purchaseOrderId","supplierId","invoiceNumber","receivedDate","total","paymentStatus"]
  },

  quotations:{
    title:"Quotations",
    endpoint:"/api/quotations",
    lineItems:true,
    fields:[
      ["customerId","Customer","customer",true],
      ["quoteDate","Quote Date","date"],
      ["validUntil","Valid Until","date"],
      ["status","Status","select",false,["DRAFT","SENT","ACCEPTED","REJECTED","EXPIRED","CONVERTED"]],
      ["discount","Document Discount","number"],
      ["notes","Notes","textarea"],
      ["terms","Terms","textarea"]
    ],
    columns:["quotationNumber","customerId","quoteDate","validUntil","status","total"]
  },

  invoices:{
    title:"Invoices",
    endpoint:"/api/invoices",
    lineItems:true,
    fields:[
      ["customerId","Customer","customer",true],
      ["jobId","Job","job"],
      ["quotationId","Quotation","quotation"],
      ["issueDate","Issue Date","date"],
      ["dueDate","Due Date","date"],
      ["discount","Document Discount","number"],
      ["notes","Notes","textarea"],
      ["terms","Terms","textarea"]
    ],
    columns:["invoiceNumber","customerId","issueDate","dueDate","status","total","paidAmount","balance"]
  },

  payments:{
    title:"Payments",
    endpoint:"/api/payments",
    fields:[],
    columns:["invoiceId","customerId","amount","method","reference","receivedAt"]
  },

  expenses:{
    title:"Expenses",
    endpoint:"/api/expenses",
    fields:[
      ["category","Category","select",true,["FUEL","SALARY","CHEMICALS","MATERIALS","VEHICLE","REPAIR","OFFICE","MARKETING","RENT","ELECTRICITY","TRAVEL","TELEPHONE","SUPPLIER","OTHER"]],
      ["description","Description","textarea"],
      ["amount","Amount","number",true],
      ["paymentMethod","Payment Method","select",false,["CASH","UPI","BANK","CARD","CHEQUE","CREDIT"]],
      ["supplierId","Supplier","supplier"],
      ["employeeId","Employee","employee"],
      ["expenseDate","Expense Date","date"],
      ["notes","Notes","textarea"]
    ],
    columns:["expenseNumber","category","description","amount","paymentMethod","expenseDate"]
  },

  employees:{
    title:"Employees",
    endpoint:"/api/employees",
    fields:[
      ["name","Employee Name","text",true],
      ["userId","System User","user"],
      ["designation","Designation","text"],
      ["department","Department","select",false,["OPERATIONS","SALES","ADMIN","HR","FINANCE","TECHNICAL","DRIVER","OTHER"]],
      ["phone","Phone","text"],
      ["email","Email","email"],
      ["address","Address","textarea"],
      ["joinDate","Join Date","date"],
      ["employmentType","Employment Type","select",false,["FULL_TIME","PART_TIME","CONTRACT"]],
      ["basicSalary","Basic Salary","number"],
      ["allowances","Allowances","number"],
      ["standardDeduction","Standard Deduction","number"],
      ["status","Status","select",false,["ACTIVE","INACTIVE"]]
    ],
    columns:["employeeCode","name","designation","department","phone","basicSalary","status"]
  },

  attendance:{
    title:"Attendance",
    endpoint:"/api/attendance",
    fields:[
      ["employeeId","Employee","employee",true],
      ["date","Date","date",true],
      ["status","Status","select",true,["PRESENT","ABSENT","HALF_DAY","LATE","LEAVE"]],
      ["checkIn","Check In","datetime"],
      ["checkOut","Check Out","datetime"],
      ["hours","Hours","number"],
      ["notes","Notes","textarea"]
    ],
    columns:["employeeId","date","status","checkIn","checkOut","hours"]
  },

  leaves:{
    title:"Leave",
    endpoint:"/api/leaves",
    fields:[
      ["employeeId","Employee","employee",true],
      ["leaveType","Leave Type","select",true,["CASUAL","SICK","ANNUAL","UNPAID","OTHER"]],
      ["startDate","Start Date","date",true],
      ["endDate","End Date","date",true],
      ["days","Days","number",true],
      ["reason","Reason","textarea"],
      ["status","Status","select",false,["PENDING","APPROVED","REJECTED","CANCELLED"]]
    ],
    columns:["employeeId","leaveType","startDate","endDate","days","status"]
  },

  advances:{
    title:"Employee Advances",
    endpoint:"/api/advances",
    fields:[
      ["employeeId","Employee","employee",true],
      ["amount","Amount","number",true],
      ["advanceDate","Advance Date","date"],
      ["reason","Reason","textarea"],
      ["status","Status","select",false,["OPEN","DEDUCTED","PAID","CANCELLED"]],
      ["notes","Notes","textarea"]
    ],
    columns:["employeeId","amount","advanceDate","reason","status"]
  },

  payroll:{
    title:"Payroll",
    endpoint:"/api/payroll",
    fields:[],
    columns:["employeeId","month","year","workingDays","presentDays","absentDays","basicSalary","netSalary","status"]
  },

  vehicles:{
    title:"Vehicles",
    endpoint:"/api/vehicles",
    fields:[
      ["vehicleNumber","Vehicle Number","text",true],
      ["vehicleType","Type","select",false,["CAR","VAN","PICKUP","BIKE","TRUCK","OTHER"]],
      ["make","Make","text"],
      ["model","Model","text"],
      ["year","Year","number"],
      ["driverId","Driver","employee"],
      ["currentOdometer","Current Odometer","number"],
      ["insuranceExpiry","Insurance Expiry","date"],
      ["pollutionExpiry","Pollution Expiry","date"],
      ["fitnessExpiry","Fitness Expiry","date"],
      ["lastServiceDate","Last Service","date"],
      ["status","Status","select",false,["ACTIVE","INACTIVE","REPAIR"]],
      ["notes","Notes","textarea"]
    ],
    columns:["vehicleNumber","make","model","currentOdometer","insuranceExpiry","fitnessExpiry","status"]
  },

  fuel:{
    title:"Fuel Logs",
    endpoint:"/api/fuel",
    fields:[
      ["vehicleId","Vehicle","vehicle",true],
      ["date","Date","date"],
      ["litres","Litres","number",true],
      ["amount","Amount","number",true],
      ["odometer","Odometer","number"],
      ["fuelType","Fuel Type","select",false,["DIESEL","PETROL","CNG","OTHER"]],
      ["station","Station","text"],
      ["notes","Notes","textarea"]
    ],
    columns:["vehicleId","date","litres","amount","odometer","fuelType"]
  },

  maintenance:{
    title:"Vehicle Maintenance",
    endpoint:"/api/maintenance",
    fields:[
      ["vehicleId","Vehicle","vehicle",true],
      ["date","Date","date"],
      ["maintenanceType","Maintenance Type","select",true,["SERVICE","REPAIR","TYRE","BATTERY","BRAKE","BODY","OTHER"]],
      ["description","Description","textarea"],
      ["amount","Amount","number",true],
      ["odometer","Odometer","number"],
      ["vendor","Vendor","text"],
      ["nextServiceDate","Next Service","date"],
      ["status","Status","select",false,["COMPLETED","PENDING","CANCELLED"]],
      ["notes","Notes","textarea"]
    ],
    columns:["vehicleId","date","maintenanceType","amount","odometer","nextServiceDate","status"]
  },

  users:{
    title:"Users",
    endpoint:"/api/users",
    fields:[
      ["username","Username","text",true],
      ["password","Password","password"],
      ["name","Name","text",true],
      ["email","Email","email"],
      ["phone","Phone","text"],
      ["role","Role","select",true,["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT","HR","STAFF","TECHNICIAN"]],
      ["branchId","Branch","branch"],
      ["status","Status","select",false,["ACTIVE","INACTIVE"]],
      ["mustChangePassword","Force Password Change","select",false,["false","true"]]
    ],
    columns:["username","name","role","phone","branchId","status","lastLoginAt"]
  },

  branches:{
    title:"Branches",
    endpoint:"/api/branches",
    fields:[
      ["code","Branch Code","text",true],
      ["name","Branch Name","text",true],
      ["phone","Phone","text"],
      ["email","Email","email"],
      ["address","Address","textarea"],
      ["city","City","text"],
      ["state","State","text"],
      ["pincode","Pincode","text"],
      ["gstin","GSTIN","text"],
      ["status","Status","select",false,["ACTIVE","INACTIVE"]]
    ],
    columns:["code","name","phone","city","state","gstin","status"]
  }
};

function headers() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });

  let data = null;
  try { data = await response.json(); } catch {}

  if (response.status === 401) {
    localStorage.removeItem("hspc_token");
    localStorage.removeItem("hspc_user");
    location.href = "/login.html";
    throw new Error("Session expired");
  }

  if (!response.ok) {
    throw new Error(data?.error || "Request failed");
  }

  return data;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style:"currency",
    currency:"INR",
    maximumFractionDigits:2
  }).format(Number(value || 0));
}

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleDateString("en-IN");
}

function fmtDateTime(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return esc(v);
  return d.toLocaleString("en-IN", {dateStyle:"short",timeStyle:"short"});
}

function inputValue(v, type) {
  if (!v) return "";
  const d = new Date(v);
  if (type === "datetime") {
    if (Number.isNaN(d.getTime())) return v;
    const pad = x => String(x).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  if (type === "date") {
    if (Number.isNaN(d.getTime())) return v;
    const pad = x => String(x).padStart(2,"0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  return v;
}

function optionList(kind, selected = "", fixed = []) {
  let list = [];

  if (kind === "customer") {
    list = state.customers.map(x => [x.id, `${x.customerCode} — ${x.name}`]);
  } else if (kind === "user") {
    list = state.users.map(x => [x.id, `${x.name} (${x.role})`]);
  } else if (kind === "userTechnician") {
    list = state.users
      .filter(x => ["TECHNICIAN","STAFF","MANAGER","ADMIN","SUPER_ADMIN"].includes(x.role))
      .map(x => [x.id, x.name]);
  } else if (kind === "employee") {
    list = state.employees.map(x => [x.id, `${x.employeeCode} — ${x.name}`]);
  } else if (kind === "product") {
    list = state.products.map(x => [x.id, `${x.name} [${x.unit}]`]);
  } else if (kind === "supplier") {
    list = state.suppliers.map(x => [x.id, x.name]);
  } else if (kind === "branch") {
    list = state.branches.map(x => [x.id, `${x.code} — ${x.name}`]);
  } else if (kind === "vehicle") {
    list = (state.records.vehicles || []).map(x => [x.id, x.vehicleNumber]);
  } else if (kind === "job") {
    list = (state.records.jobs || []).map(x => [x.id, `${x.jobNumber} — ${x.serviceType}`]);
  } else if (kind === "quotation") {
    list = (state.records.quotations || []).map(x => [x.id, x.quotationNumber]);
  } else {
    list = fixed.map(x => [x, x]);
  }

  return `<option value="">Select</option>` +
    list.map(([value,label]) =>
      `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(label)}</option>`
    ).join("");
}

function fieldHTML(field, value = "") {
  const [name,label,type,required,options] = field;
  const req = required ? "required" : "";
  const val = inputValue(value,type);

  if (type === "textarea") {
    return `<label>${esc(label)}<textarea name="${esc(name)}" ${req}>${esc(val)}</textarea></label>`;
  }

  if (type === "select") {
    return `<label>${esc(label)}<select name="${esc(name)}" ${req}>${optionList("fixed",val,options || [])}</select></label>`;
  }

  if (["customer","contract","user","userTechnician","employee","supplier","branch","vehicle","job","quotation"].includes(type)) {
    return `<label>${esc(label)}<select name="${esc(name)}" ${req}>${optionList(type,val)}</select></label>`;
  }

  return `<label>${esc(label)}<input name="${esc(name)}" type="${type === "datetime" ? "datetime-local" : type}" value="${esc(val)}" ${req}></label>`;
}

function renderNav() {
  const html = NAV.map(([group,links]) => {
    const permitted = links.filter(x => x[3].includes("*") || x[3].includes(role()));
    if (!permitted.length) return "";
    return `
      <div class="nav-group">${group}</div>
      ${permitted.map(([page,icon,label]) => `
        <button class="nav-link ${state.page === page ? "active":""}" onclick="go('${page}')">
          <span>${icon}</span><span>${label}</span>
        </button>
      `).join("")}
    `;
  }).join("");

  document.getElementById("nav").innerHTML = html;
}

function go(page) {
  state.page = page;
  history.replaceState({}, "", `?page=${encodeURIComponent(page)}`);
  renderNav();
  renderPage().catch(showError);
  document.getElementById("sidebar")?.classList.remove("open");
}

function toggleSidebar() {
  document.getElementById("sidebar").classList.toggle("open");
}

function logout() {
  localStorage.clear();
  location.href = "/login.html";
}

function toast(message, success = true) {
  const host = document.getElementById("toastHost");
  const div = document.createElement("div");
  div.className = "toast";
  div.textContent = message;
  host.appendChild(div);
  setTimeout(() => div.remove(), success ? 2600 : 4200);
}

function showError(err) {
  console.error(err);
  toast(err.message || String(err), false);
}

function badge(value) {
  const s = String(value || "—").toUpperCase();
  let cls = "gray";

  if (["ACTIVE","COMPLETED","PAID","APPROVED","DONE","RECEIVED"].includes(s)) cls = "green";
  else if (["PENDING","PARTIAL","IN_PROGRESS","SCHEDULED","ORDERED"].includes(s)) cls = "amber";
  else if (["CANCELLED","REJECTED","INACTIVE","OVERDUE"].includes(s)) cls = "red";
  else if (["SENT","ASSIGNED","CONVERTED"].includes(s)) cls = "blue";

  return `<span class="badge ${cls}">${esc(s.replaceAll("_"," "))}</span>`;
}

function lookup(kind,id) {
  if (!id) return "—";

  if (kind === "customer") {
    return state.customers.find(x => x.id === id)?.name || id;
  }

  if (kind === "user" || kind === "userTechnician") {
    return state.users.find(x => x.id === id)?.name || id;
  }

  if (kind === "employee") {
    return state.employees.find(x => x.id === id)?.name || id;
  }

  if (kind === "supplier") {
    return state.suppliers.find(x => x.id === id)?.name || id;
  }

  if (kind === "branch") {
    return state.branches.find(x => x.id === id)?.name || id;
  }

  if (kind === "vehicle") {
    return (state.records.vehicles || []).find(x => x.id === id)?.vehicleNumber || id;
  }

  if (kind === "job") {
    return (state.records.jobs || []).find(x => x.id === id)?.jobNumber || id;
  }

  if (kind === "quotation") {
    return (state.records.quotations || []).find(x => x.id === id)?.quotationNumber || id;
  }

  return id;
}

function displayValue(row, field) {
  const raw = row[field];
  const config = CONFIG[state.page] || {};

  const f = (config.fields || []).find(x => x[0] === field);

  if (field.toLowerCase().includes("amount") ||
      ["total","paidAmount","balance","basicSalary","allowances","netSalary","tax","subtotal","discount","litres"].includes(field)) {
    if (typeof raw === "number") return money(raw);
  }

  if (field.toLowerCase().includes("date") ||
      field.endsWith("At") ||
      field === "issueDate" ||
      field === "quoteDate" ||
      field === "orderDate" ||
      field === "receivedAt") {
    return field.includes("At") || field.includes("Start") || field.includes("End")
      ? fmtDateTime(raw)
      : fmtDate(raw);
  }

  if (f && ["customer","contract","user","userTechnician","employee","supplier","branch","vehicle","job","quotation"].includes(f[2])) {
    return esc(lookup(f[2],raw));
  }

  if (field === "status") return badge(raw);

  return esc(raw ?? "—");
}

async function loadList(key, endpoint = null) {
  const url = endpoint || CONFIG[key].endpoint;
  state.records[key] = await api(url);
  return state.records[key];
}

function actionButtons(key,row) {
  const actions = [];

  if (key === "customers") {
    actions.push(`<button class="btn btn-secondary" onclick='viewCustomer("${row.id}")'>History</button>`);
  }

  if (key === "jobs") {
    actions.push(`<button class="btn btn-secondary" onclick='viewJob("${row.id}")'>View</button>`);
    if (row.status !== "COMPLETED") {
      actions.push(`<button class="btn btn-primary" onclick='completeJob("${row.id}")'>Complete</button>`);
    }
  }

  if (key === "contracts") {
    actions.push(`<button class="btn btn-primary" onclick='generateContractJob("${row.id}")'>Generate Job</button>`);
  }

  if (key === "inventory") {
    actions.push(`<button class="btn btn-secondary" onclick='adjustStock("${row.id}")'>Adjust Stock</button>`);
  }

  if (key === "purchase-orders") {
    if (row.status !== "RECEIVED") {
      actions.push(`<button class="btn btn-primary" onclick='receivePO("${row.id}")'>Receive</button>`);
    }
  }

  if (key === "quotations") {
    actions.push(`<button class="btn btn-secondary" onclick='viewQuote("${row.id}")'>View</button>`);
    if (row.status !== "CONVERTED") {
      actions.push(`<button class="btn btn-primary" onclick='convertQuote("${row.id}")'>Convert to Invoice</button>`);
    }
  }

  if (key === "invoices") {
    actions.push(`<button class="btn btn-secondary" onclick='viewInvoice("${row.id}")'>View</button>`);
    if (Number(row.balance) > 0) {
      actions.push(`<button class="btn btn-primary" onclick='recordPayment("${row.id}")'>Payment</button>`);
    }
    actions.push(`<button class="btn btn-secondary" onclick='printInvoice("${row.id}")'>Print</button>`);
  }

  return actions.join("");
}

function renderTable(key, rows) {
  const config = CONFIG[key];
  const columns = config.columns || [];

  if (!rows?.length) {
    return `<div class="empty">No records found.</div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${columns.map(c => `<th>${esc(c)}</th>`).join("")}
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              ${columns.map(c => `<td>${displayValue(row,c)}</td>`).join("")}
              <td><div class="table-actions">
                ${actionButtons(key,row)}
                ${!["invoices","quotations","jobs","customers","contracts","purchase-orders","inventory"].includes(key)
                  ? `<button class="btn btn-secondary" onclick='editResource("${key}","${row.id}")'>Edit</button>`
                  : ""}
              </div></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function renderCRUD(key) {
  const config = CONFIG[key];

  let rows = await loadList(key);
  if (key === "users") {
    state.users = rows;
  }
  if (key === "employees") state.employees = rows;
  if (key === "products") state.products = rows;
  if (key === "suppliers") state.suppliers = rows;
  if (key === "branches") state.branches = rows;

  const body = `
    <div class="page-actions">
      <div class="left">
        <input id="pageSearch" class="search" placeholder="Search ${esc(config.title)}..." oninput="filterTable('${key}',this.value)">
      </div>
      <div class="right">
        <button class="btn btn-secondary" onclick='exportCSV("${key}")'>Export CSV</button>
        ${["payments","payroll"].includes(key) ? "" : `<button class="btn btn-primary" onclick='openEditor("${key}")'>+ New ${esc(config.title.replace(/s$/,""))}</button>`}
      </div>
    </div>
    <div id="tableArea">${renderTable(key,rows)}</div>
  `;

  document.getElementById("content").innerHTML = body;

  if (key === "purchases") {
    document.querySelector(".page-actions .right").innerHTML +=
      `<button class="btn btn-primary" onclick='openEditor("purchases")'>+ Direct Purchase</button>`;
  }

  if (key === "payments") {
    document.querySelector(".page-actions .right").innerHTML +=
      `<button class="btn btn-primary" onclick='openPaymentEditor()'>+ Record Payment</button>`;
  }

  if (key === "payroll") {
    document.querySelector(".page-actions .right").innerHTML +=
      `<button class="btn btn-primary" onclick='generatePayroll()'>Generate Payroll</button>`;
  }
}

function filterTable(key,value) {
  const q = String(value || "").toLowerCase();
  const rows = state.records[key] || [];
  const filtered = rows.filter(row =>
    Object.values(row).some(v => String(v ?? "").toLowerCase().includes(q))
  );
  document.getElementById("tableArea").innerHTML = renderTable(key,filtered);
}

function editorFieldGrid(fields,row) {
  return `
    <div class="grid grid-2">
      ${fields.map(f => fieldHTML(f,row?.[f[0]] ?? "")).join("")}
    </div>
  `;
}

function lineItemsHTML(items = [], purchase = false) {
  const rows = items.length ? items : [{}];

  return `
    <section class="line-items">
      <div class="line-items-header">
        <strong>Line Items</strong>
        <button type="button" class="btn btn-secondary" onclick="addLineRow()">+ Add Item</button>
      </div>
      <div id="lineRows">
        ${rows.map((item,index) => lineRowHTML(item,purchase,index)).join("")}
      </div>
    </section>
  `;
}

function lineRowHTML(item={},purchase=false,index=0) {
  return `
    <div class="line-row" data-line="${index}">
      <label>Product
        <select class="line-product" onchange="fillProductLine(this)">
          ${optionList("product",item.productId || "")}
        </select>
      </label>
      <label>Description
        <input class="line-description" value="${esc(item.description || "")}">
      </label>
      <label>Qty
        <input class="line-qty" type="number" min="0.01" step="0.01" value="${esc(item.quantity ?? 1)}">
      </label>
      <label>${purchase ? "Unit Cost":"Unit Price"}
        <input class="line-price" type="number" step="0.01" value="${esc(item.unitPrice ?? item.unitCost ?? 0)}">
      </label>
      <label>Discount
        <input class="line-discount" type="number" step="0.01" value="${esc(item.discount ?? 0)}">
      </label>
      <label>GST %
        <input class="line-tax" type="number" step="0.01" value="${esc(item.taxRate ?? 18)}">
      </label>
      <button type="button" class="btn btn-danger" onclick="this.closest('.line-row').remove()">×</button>
    </div>
  `;
}

function addLineRow() {
  const host = document.getElementById("lineRows");
  if (!host) return;
  const purchase = document.getElementById("lineItemsForm")?.dataset.purchase === "1";
  host.insertAdjacentHTML("beforeend",lineRowHTML({},purchase,host.children.length));
}

function fillProductLine(select) {
  const product = state.products.find(x => x.id === select.value);
  const row = select.closest(".line-row");
  if (!product || !row) return;

  row.querySelector(".line-description").value = product.name;
  row.querySelector(".line-price").value = product.sellingPrice ?? 0;
  row.querySelector(".line-tax").value = product.taxRate ?? 18;
}

function collectLines() {
  return [...document.querySelectorAll("#lineRows .line-row")].map(row => ({
    productId: row.querySelector(".line-product")?.value || undefined,
    description: row.querySelector(".line-description")?.value || "",
    quantity: Number(row.querySelector(".line-qty")?.value || 0),
    unitPrice: Number(row.querySelector(".line-price")?.value || 0),
    unitCost: Number(row.querySelector(".line-price")?.value || 0),
    discount: Number(row.querySelector(".line-discount")?.value || 0),
    taxRate: Number(row.querySelector(".line-tax")?.value || 18)
  })).filter(x => x.quantity > 0);
}

async function openEditor(key,id=null) {
  const config = CONFIG[key];
  let row = null;

  if (id) {
    row = (state.records[key] || []).find(x => x.id === id) || null;
  }

  if (!row && key === "purchases" && id) {
    row = await api(`${config.endpoint}`);
  }

  document.getElementById("modalEyebrow").textContent = "HSPC ERP";
  document.getElementById("modalTitle").textContent =
    `${id ? "Edit":"New"} ${config.title.replace(/s$/,"")}`;

  const purchase = ["purchase-orders","purchases"].includes(key);

  const fields = config.fields || [];

  document.getElementById("modalBody").innerHTML = `
    <form id="editorForm" class="modal-body">
      ${fields.length ? editorFieldGrid(fields,row) : ""}
      ${config.lineItems ? lineItemsHTML(row?.items || [],purchase) : ""}
      ${key === "purchases" && !fields.length ? `
        <div class="grid grid-2">
          ${fieldHTML(["supplierId","Supplier","supplier",true],row?.supplierId || "")}
          ${fieldHTML(["invoiceNumber","Supplier Invoice Number","text"],row?.invoiceNumber || "")}
          ${fieldHTML(["receivedDate","Received Date","date"],row?.receivedDate || "")}
          ${fieldHTML(["paymentStatus","Payment Status","select"],row?.paymentStatus || "",false)}
          ${fieldHTML(["notes","Notes","textarea"],row?.notes || "")}
        </div>
      ` : ""}
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" type="submit">Save</button>
      </div>
    </form>
  `;

  if (key === "purchases") {
    document.getElementById("lineItemsForm")?.setAttribute("data-purchase","1");
    const ps = document.querySelector('select[name="paymentStatus"]');
    if (ps) ps.innerHTML = optionList("fixed",row?.paymentStatus || "UNPAID",["UNPAID","PARTIAL","PAID"]);
  }

  document.getElementById("editorForm").addEventListener("submit",async e => {
    e.preventDefault();

    const form = e.target;
    const data = {};

    for (const field of fields) {
      const [name] = field;
      const el = form.elements[name];
      if (!el) continue;
      data[name] = el.value;
    }

    if (key === "users") {
      data.mustChangePassword = data.mustChangePassword === "true";
    }

    if (config.lineItems) {
      data.items = collectLines();
      if (!data.items.length) {
        toast("Add at least one line item",false);
        return;
      }
    }

    try {
      if (id) {
        await api(`${config.endpoint}/${id}`,{
          method:"PUT",
          body:JSON.stringify(data)
        });
      } else {
        await api(config.endpoint,{
          method:"POST",
          body:JSON.stringify(data)
        });
      }

      closeModal();
      toast(`${config.title} saved`);
      await reloadPageData();
    } catch(err) {
      showError(err);
    }
  });

  openModal();
}

function openModal() {
  document.getElementById("modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

async function viewCustomer(id) {
  try {
    const data = await api(`/api/customers/${id}`);
    const c = data.customer;

    document.getElementById("modalTitle").textContent = c.name;
    document.getElementById("modalEyebrow").textContent = "CUSTOMER HISTORY";

    document.getElementById("modalBody").innerHTML = `
      <div class="modal-body">
        <div class="detail-grid">
          <div class="detail-item"><span>Customer Code</span><strong>${esc(c.customerCode)}</strong></div>
          <div class="detail-item"><span>Phone</span><strong>${esc(c.phone || "—")}</strong></div>
          <div class="detail-item"><span>GSTIN</span><strong>${esc(c.gstin || "—")}</strong></div>
          <div class="detail-item"><span>Location</span><strong>${esc([c.city,c.state].filter(Boolean).join(", "))}</strong></div>
        </div>

        <div class="section-title"><h2>Service History</h2></div>
        ${renderTable("jobs",data.jobs)}

        <div class="section-title"><h2>Contracts</h2></div>
        ${data.contracts.length ? `<div class="table-wrap"><table><thead><tr><th>Contract</th><th>Service</th><th>Next Visit</th><th>Status</th></tr></thead><tbody>
          ${data.contracts.map(x => `<tr><td>${esc(x.contractNumber)}</td><td>${esc(x.serviceType)}</td><td>${fmtDate(x.nextServiceDate)}</td><td>${badge(x.status)}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No contracts.</div>`}

        <div class="section-title"><h2>Invoices</h2></div>
        ${data.invoices.length ? `<div class="table-wrap"><table><thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>
          ${data.invoices.map(x => `<tr><td>${esc(x.invoiceNumber)}</td><td>${fmtDate(x.issueDate)}</td><td>${money(x.total)}</td><td>${money(x.paidAmount)}</td><td>${money(x.balance)}</td><td>${badge(x.status)}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">No invoices.</div>`}
      </div>
    `;

    openModal();
  } catch(err) {
    showError(err);
  }
}

async function viewJob(id) {
  const data = await api(`/api/jobs/${id}`);
  const j = data.job;

  document.getElementById("modalTitle").textContent = j.jobNumber;
  document.getElementById("modalEyebrow").textContent = "JOB DETAIL";

  document.getElementById("modalBody").innerHTML = `
    <div class="modal-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Customer</span><strong>${esc(data.customer?.name || j.customerId)}</strong></div>
        <div class="detail-item"><span>Service</span><strong>${esc(j.serviceType)}</strong></div>
        <div class="detail-item"><span>Schedule</span><strong>${fmtDateTime(j.scheduledStart)}</strong></div>
        <div class="detail-item"><span>Status</span><strong>${badge(j.status)}</strong></div>
        <div class="detail-item"><span>Technician</span><strong>${esc(lookup("user",j.technicianId))}</strong></div>
        <div class="detail-item"><span>Amount</span><strong>${money(j.actualAmount || j.estimatedAmount)}</strong></div>
      </div>

      <div class="section-title"><h2>Materials Used</h2></div>
      ${data.usage.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Cost</th></tr></thead><tbody>
        ${data.usage.map(x => `<tr><td>${esc(lookup("product",x.productId))}</td><td>${x.quantity}</td><td>${money(x.totalCost)}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty">No material usage recorded.</div>`}
    </div>
  `;

  openModal();
}

async function completeJob(id) {
  const amount = prompt("Final service amount:", "0");
  if (amount === null) return;

  try {
    await api(`/api/jobs/${id}/complete`,{
      method:"POST",
      body:JSON.stringify({actualAmount:Number(amount)})
    });
    toast("Job completed");
    reloadPageData();
  } catch(err) { showError(err); }
}

async function generateContractJob(id) {
  try {
    await api(`/api/contracts/${id}/generate-job`,{method:"POST",body:"{}"});
    toast("Service job generated");
    reloadPageData();
  } catch(err) { showError(err); }
}

async function adjustStock(id) {
  const product = state.products.find(x => x.id === id);
  if (!product) return;

  const qty = prompt(`Adjust stock for ${product.name}\nCurrent stock: ${product.currentStock}\nEnter + for received or - for issue:`);
  if (qty === null) return;

  const amount = Number(qty);
  if (!Number.isFinite(amount) || amount === 0) {
    toast("Enter a non-zero number",false);
    return;
  }

  try {
    await api("/api/stock/adjust",{
      method:"POST",
      body:JSON.stringify({
        productId:id,
        quantity:amount,
        reference:"MANUAL",
        notes:"Manual stock adjustment"
      })
    });
    toast("Stock updated");
    reloadPageData();
  } catch(err) { showError(err); }
}

async function receivePO(id) {
  const answer = confirm("Mark this purchase order as received and add the ordered quantity to stock?");
  if (!answer) return;

  try {
    await api(`/api/purchase-orders/${id}/receive`,{
      method:"POST",
      body:"{}"
    });
    toast("Purchase received and stock updated");
    reloadPageData();
  } catch(err) { showError(err); }
}

async function viewQuote(id) {
  const row = (state.records.quotations || []).find(x => x.id === id);
  if (!row) return;

  document.getElementById("modalTitle").textContent = row.quotationNumber;
  document.getElementById("modalEyebrow").textContent = "QUOTATION";

  document.getElementById("modalBody").innerHTML = `
    <div class="modal-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Customer</span><strong>${esc(lookup("customer",row.customerId))}</strong></div>
        <div class="detail-item"><span>Date</span><strong>${fmtDate(row.quoteDate)}</strong></div>
        <div class="detail-item"><span>Total</span><strong>${money(row.total)}</strong></div>
        <div class="detail-item"><span>Status</span><strong>${badge(row.status)}</strong></div>
      </div>
      <div class="section-title"><h2>Items</h2></div>
      ${renderItemsTable(row.items || [])}
    </div>
  `;

  openModal();
}

function renderItemsTable(items) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Discount</th><th>GST</th><th>Total</th></tr></thead>
        <tbody>
          ${(items || []).map(x => `
            <tr>
              <td>${esc(x.description)}</td>
              <td>${x.quantity}</td>
              <td>${money(x.unitPrice)}</td>
              <td>${money(x.discount)}</td>
              <td>${x.taxRate}%</td>
              <td>${money(x.total)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

async function convertQuote(id) {
  if (!confirm("Convert this quotation into an invoice?")) return;

  try {
    await api(`/api/quotations/${id}/convert`,{method:"POST",body:"{}"});
    toast("Quotation converted to invoice");
    reloadPageData();
  } catch(err) { showError(err); }
}

async function viewInvoice(id) {
  const data = await api(`/api/invoices/${id}`);
  const x = data.invoice;

  document.getElementById("modalTitle").textContent = x.invoiceNumber;
  document.getElementById("modalEyebrow").textContent = "INVOICE";

  document.getElementById("modalBody").innerHTML = `
    <div class="modal-body">
      <div class="detail-grid">
        <div class="detail-item"><span>Customer</span><strong>${esc(data.customer?.name || x.customerId)}</strong></div>
        <div class="detail-item"><span>Issue Date</span><strong>${fmtDate(x.issueDate)}</strong></div>
        <div class="detail-item"><span>Total</span><strong>${money(x.total)}</strong></div>
        <div class="detail-item"><span>Paid</span><strong>${money(x.paidAmount)}</strong></div>
        <div class="detail-item"><span>Balance</span><strong>${money(x.balance)}</strong></div>
        <div class="detail-item"><span>Status</span><strong>${badge(x.status)}</strong></div>
      </div>
      <div class="section-title"><h2>Items</h2></div>
      ${renderItemsTable(data.items || [])}
      <div class="section-title"><h2>Payments</h2></div>
      ${data.payments.length ? renderSimplePayments(data.payments) : `<div class="empty">No payments.</div>`}
    </div>
  `;

  openModal();
}

function renderSimplePayments(rows) {
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>
      <tbody>${rows.map(x => `
        <tr><td>${fmtDateTime(x.receivedAt)}</td><td>${money(x.amount)}</td><td>${esc(x.method)}</td><td>${esc(x.reference || "—")}</td></tr>
      `).join("")}</tbody>
    </table></div>
  `;
}

async function recordPayment(invoiceId) {
  openPaymentEditor(invoiceId);
}

function openPaymentEditor(invoiceId = "") {
  const invoiceRows = state.records.invoices || [];

  document.getElementById("modalTitle").textContent = "Record Payment";
  document.getElementById("modalEyebrow").textContent = "RECEIPT";

  const selected = invoiceRows.find(x => x.id === invoiceId);

  document.getElementById("modalBody").innerHTML = `
    <form id="paymentForm" class="modal-body">
      <div class="grid grid-2">
        <label>Invoice
          <select name="invoiceId" required>
            <option value="">Select</option>
            ${invoiceRows.filter(x => Number(x.balance) > 0).map(x =>
              `<option value="${x.id}" ${x.id === invoiceId ? "selected":""}>${esc(x.invoiceNumber)} — ${money(x.balance)}</option>`
            ).join("")}
          </select>
        </label>
        <label>Amount
          <input name="amount" type="number" min="0.01" step="0.01" value="${esc(Math.max(0,selected?.balance || 0))}" required>
        </label>
        <label>Method
          <select name="method">
            ${optionList("fixed","CASH",["CASH","UPI","BANK","CARD","CHEQUE","OTHER"])}
          </select>
        </label>
        <label>Reference
          <input name="reference">
        </label>
        <label>Received Date
          <input name="receivedAt" type="datetime-local" value="${inputValue(new Date().toISOString(),"datetime")}">
        </label>
        <label>Notes
          <textarea name="notes"></textarea>
        </label>
      </div>

      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Receipt</button>
      </div>
    </form>
  `;

  document.getElementById("paymentForm").addEventListener("submit",async e => {
    e.preventDefault();
    const f = e.target;

    try {
      await api("/api/payments",{
        method:"POST",
        body:JSON.stringify({
          invoiceId:f.invoiceId.value,
          amount:Number(f.amount.value),
          method:f.method.value,
          reference:f.reference.value,
          receivedAt:f.receivedAt.value,
          notes:f.notes.value
        })
      });

      closeModal();
      toast("Payment recorded");
      reloadPageData();
    } catch(err) { showError(err); }
  });

  openModal();
}

async function printInvoice(id) {
  try {
    const data = await api(`/api/invoices/${id}`);
    const settings = state.settings;

    const html = `
      <!doctype html>
      <html>
      <head>
        <title>${esc(data.invoice.invoiceNumber)}</title>
        <style>
          body{font-family:Arial,sans-serif;padding:35px;color:#18251f}
          h1{margin:0 0 5px}
          .muted{color:#67756f}
          .head{display:flex;justify-content:space-between;border-bottom:2px solid #0a7c5a;padding-bottom:18px}
          table{width:100%;border-collapse:collapse;margin-top:22px}
          th,td{border:1px solid #dfe8e3;padding:9px;text-align:left}
          th{background:#f3f8f5}
          .totals{margin-top:18px;margin-left:auto;width:300px}
          .totals div{display:flex;justify-content:space-between;padding:5px 0}
          .grand{font-weight:bold;font-size:18px;border-top:2px solid #0a7c5a;padding-top:9px}
        </style>
      </head>
      <body>
        <div class="head">
          <div>
            <h1>${esc(settings.companyName || "Home Safety Pest Control Service")}</h1>
            <div class="muted">${esc(settings.companyCity || "")}, ${esc(settings.companyState || "")}</div>
            <div class="muted">${esc(settings.companyGSTIN || "")}</div>
          </div>
          <div>
            <h2>${esc(data.invoice.invoiceNumber)}</h2>
            <div>Issue: ${fmtDate(data.invoice.issueDate)}</div>
            <div>Due: ${fmtDate(data.invoice.dueDate)}</div>
          </div>
        </div>

        <h3>Bill To</h3>
        <div>
          <strong>${esc(data.customer?.name || "")}</strong><br>
          ${esc(data.customer?.address || "")}<br>
          ${esc(data.customer?.city || "")}, ${esc(data.customer?.state || "")}<br>
          ${esc(data.customer?.phone || "")}<br>
          ${esc(data.customer?.gstin || "")}
        </div>

        ${renderPrintableItems(data.items)}

        <div class="totals">
          <div><span>Subtotal</span><span>${money(data.invoice.subtotal)}</span></div>
          <div><span>Discount</span><span>${money(data.invoice.discount)}</span></div>
          <div><span>Taxable</span><span>${money(data.invoice.taxable)}</span></div>
          <div><span>CGST</span><span>${money(data.invoice.cgst)}</span></div>
          <div><span>SGST</span><span>${money(data.invoice.sgst)}</span></div>
          <div><span>IGST</span><span>${money(data.invoice.igst)}</span></div>
          <div class="grand"><span>Total</span><span>${money(data.invoice.total)}</span></div>
          <div><span>Paid</span><span>${money(data.invoice.paidAmount)}</span></div>
          <div><span>Balance</span><span>${money(data.invoice.balance)}</span></div>
        </div>

        <p style="margin-top:40px">${esc(data.invoice.terms || "")}</p>
        <p>${esc(data.invoice.notes || "")}</p>
      </body>
      </html>
    `;

    const win = window.open("", "_blank");
    if (!win) {
      toast("Pop-up blocked by browser",false);
      return;
    }

    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 350);
  } catch(err) {
    showError(err);
  }
}

function renderPrintableItems(items) {
  return `
    <table>
      <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Discount</th><th>GST</th><th>Total</th></tr></thead>
      <tbody>${(items || []).map(x => `
        <tr>
          <td>${esc(x.description)}</td>
          <td>${x.quantity}</td>
          <td>${money(x.unitPrice)}</td>
          <td>${money(x.discount)}</td>
          <td>${x.taxRate}%</td>
          <td>${money(x.total)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

async function generatePayroll() {
  const now = new Date();

  try {
    await api("/api/payroll/generate",{
      method:"POST",
      body:JSON.stringify({
        month: now.getMonth()+1,
        year: now.getFullYear()
      })
    });

    toast("Payroll generated");
    reloadPageData();
  } catch(err) { showError(err); }
}

async function editResource(key,id) {
  await openEditor(key,id);
}

async function exportCSV(key) {
  const rows = state.records[key] || [];
  if (!rows.length) {
    toast("Nothing to export",false);
    return;
  }

  const cols = CONFIG[key].columns || Object.keys(rows[0]);
  const csv = [
    cols.join(","),
    ...rows.map(row =>
      cols.map(c =>
        `"${String(row[c] ?? "").replaceAll('"','""')}"`
      ).join(",")
    )
  ].join("\n");

  const blob = new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${key}-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function renderDashboard() {
  const data = await api("/api/dashboard");

  document.getElementById("content").innerHTML = `
    <div class="kpi-row">
      <div class="card metric"><span class="label">Active Customers</span><span class="value">${data.customers}</span><span class="sub">CRM</span></div>
      <div class="card metric"><span class="label">Jobs — 30 Days</span><span class="value">${data.jobs}</span><span class="sub">Operations</span></div>
      <div class="card metric"><span class="label">Revenue — 30 Days</span><span class="value">${money(data.revenue)}</span><span class="sub">Paid invoices</span></div>
      <div class="card metric"><span class="label">Outstanding</span><span class="value">${money(data.outstanding)}</span><span class="sub">Receivables</span></div>
      <div class="card metric"><span class="label">Operating Profit</span><span class="value">${money(data.profit)}</span><span class="sub">Revenue − expenses − payroll</span></div>
    </div>

    <div class="grid grid-2" style="margin-top:14px">
      <section class="card">
        <div class="section-title"><h2>Today’s Jobs</h2><button class="btn btn-secondary" onclick="go('schedule')">Schedule</button></div>
        ${data.todayJobs.length ? `
          <div class="notice-list">
            ${data.todayJobs.map(j => `
              <div class="notice">
                <strong>${esc(j.jobNumber)} · ${esc(j.serviceType)}</strong>
                <span>${fmtDateTime(j.scheduledStart)} · ${esc(lookup("customer",j.customerId))} · ${badge(j.status)}</span>
              </div>
            `).join("")}
          </div>
        ` : `<div class="empty">No jobs scheduled for today.</div>`}
      </section>

      <section class="card">
        <div class="section-title"><h2>Inventory Alerts</h2><button class="btn btn-secondary" onclick="go('inventory')">Inventory</button></div>
        ${data.lowStock.length ? `
          <div class="notice-list">
            ${data.lowStock.map(p => `
              <div class="notice">
                <strong>${esc(p.name)}</strong>
                <span>Stock ${p.currentStock} ${esc(p.unit)} · Minimum ${p.minStock}</span>
              </div>
            `).join("")}
          </div>
        ` : `<div class="alert success">No low-stock items.</div>`}
      </section>
    </div>

    <section class="card" style="margin-top:14px">
      <div class="section-title"><h2>Finance Snapshot</h2><button class="btn btn-secondary" onclick="go('reports')">Open Reports</button></div>
      <div class="grid grid-4">
        <div><div class="muted">Billed</div><strong>${money(data.billed)}</strong></div>
        <div><div class="muted">Paid</div><strong>${money(data.revenue)}</strong></div>
        <div><div class="muted">Expenses</div><strong>${money(data.expenses)}</strong></div>
        <div><div class="muted">Payroll</div><strong>${money(data.payroll)}</strong></div>
      </div>
    </section>
  `;
}

async function renderInventory() {
  state.records.inventory = await api("/api/products");
  state.products = state.records.inventory;

  const expiring = await api("/api/inventory/expiring?days=30");

  document.getElementById("content").innerHTML = `
    <div class="page-actions">
      <div class="left">
        <input id="pageSearch" class="search" placeholder="Search inventory..." oninput="filterTable('inventory',this.value)">
      </div>
      <div class="right">
        <button class="btn btn-secondary" onclick='exportCSV("inventory")'>Export CSV</button>
        <button class="btn btn-primary" onclick='openEditor("products")'>+ New Item</button>
      </div>
    </div>

    ${renderTable("inventory",state.records.inventory)}

    <div class="section-title"><h2>Expiring Batches — Next 30 Days</h2></div>
    ${expiring.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th>Product</th><th>Batch</th><th>Expiry</th><th>Quantity</th></tr></thead>
        <tbody>${expiring.map(x => `
          <tr><td>${esc(lookup("product",x.productId))}</td><td>${esc(x.batchNumber)}</td><td>${fmtDate(x.expiryDate)}</td><td>${x.quantity}</td></tr>
        `).join("")}</tbody>
      </table></div>
    ` : `<div class="alert success">No batches expiring within 30 days.</div>`}
  `;
}

async function renderReports() {
  document.getElementById("content").innerHTML = `
    <div class="card">
      <form id="reportForm">
        <div class="grid grid-3">
          <label>From <input type="date" name="from"></label>
          <label>To <input type="date" name="to"></label>
          <div style="display:flex;align-items:end"><button class="btn btn-primary" type="submit">Refresh Report</button></div>
        </div>
      </form>
    </div>
    <div id="reportArea" style="margin-top:14px"></div>
  `;

  document.getElementById("reportForm").addEventListener("submit", e => {
    e.preventDefault();
    loadReport(e.target.from.value,e.target.to.value).catch(showError);
  });

  await loadReport();
}

async function loadReport(from="",to="") {
  let url = "/api/reports/summary";
  if (from || to) {
    url += `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }

  const data = await api(url);

  document.getElementById("reportArea").innerHTML = `
    <div class="kpi-row">
      <div class="card metric"><span class="label">Revenue</span><span class="value">${money(data.revenue)}</span></div>
      <div class="card metric"><span class="label">Billed</span><span class="value">${money(data.billed)}</span></div>
      <div class="card metric"><span class="label">Expenses</span><span class="value">${money(data.expenses)}</span></div>
      <div class="card metric"><span class="label">Payroll</span><span class="value">${money(data.payroll)}</span></div>
      <div class="card metric"><span class="label">Profit</span><span class="value">${money(data.profit)}</span></div>
    </div>

    <div class="grid grid-2" style="margin-top:14px">
      <div class="card">
        <div class="section-title"><h2>Jobs by Status</h2></div>
        ${Object.entries(data.jobsByStatus).map(([k,v]) => `
          <div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:11px"><span>${esc(k)}</span><strong>${v}</strong></div>
            <div class="chart"><div style="width:${Math.min(100,Number(v)/Math.max(1,data.jobs)*100)}%"></div></div>
          </div>
        `).join("")}
      </div>

      <div class="card">
        <div class="section-title"><h2>Performance</h2></div>
        <div class="grid grid-2">
          <div><span class="muted">Jobs</span><h3>${data.jobs}</h3></div>
          <div><span class="muted">Customers</span><h3>${data.customers}</h3></div>
          <div><span class="muted">Low Stock</span><h3>${data.lowStockCount}</h3></div>
          <div><span class="muted">Expiring Batches</span><h3>${data.expiringCount}</h3></div>
        </div>
      </div>
    </div>

    <div class="section-title"><h2>Technician Performance</h2></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Technician</th><th>Jobs</th><th>Revenue</th></tr></thead>
        <tbody>
          ${data.technicianPerformance.length ? data.technicianPerformance.map(x => `
            <tr>
              <td>${esc(lookup("user",x.technicianId))}</td>
              <td>${x.jobs}</td>
              <td>${money(x.revenue)}</td>
            </tr>
          `).join("") : `<tr><td colspan="3">No technician data for this period.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

async function renderSchedule() {
  const jobs = await api("/api/jobs");
  state.records.jobs = jobs;

  const start = new Date();
  start.setHours(0,0,0,0);

  const days = [...Array(7)].map((_,i) => {
    const d = new Date(start);
    d.setDate(d.getDate()+i);
    return d;
  });

  document.getElementById("content").innerHTML = `
    <div class="grid grid-3">
      ${days.map(d => {
        const dayJobs = jobs.filter(j => {
          if (!j.scheduledStart) return false;
          const x = new Date(j.scheduledStart);
          return x.getFullYear() === d.getFullYear() &&
            x.getMonth() === d.getMonth() &&
            x.getDate() === d.getDate();
        });

        return `
          <section class="card">
            <div class="section-title">
              <h2>${d.toLocaleDateString("en-IN",{weekday:"short"})}</h2>
              <span class="muted">${d.toLocaleDateString("en-IN")}</span>
            </div>
            <div class="notice-list">
              ${dayJobs.length ? dayJobs.map(j => `
                <div class="notice" onclick='viewJob("${j.id}")' style="cursor:pointer">
                  <strong>${fmtDateTime(j.scheduledStart)}</strong>
                  <span>${esc(j.jobNumber)} · ${esc(j.serviceType)}</span>
                  <span>${esc(lookup("customer",j.customerId))} · ${badge(j.status)}</span>
                </div>
              `).join("") : `<div class="empty">No jobs</div>`}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

async function renderBackup() {
  document.getElementById("content").innerHTML = `
    <div class="card">
      <h3>Database Backup</h3>
      <p class="muted">Create a consistent SQLite backup in the server backups directory.</p>
      <button class="btn btn-primary" onclick="createBackup()">Create Backup Now</button>
      <div id="backupResult" style="margin-top:12px"></div>
    </div>
  `;
}

async function createBackup() {
  try {
    const data = await api("/api/backup",{method:"POST",body:"{}"});
    document.getElementById("backupResult").innerHTML =
      `<div class="alert success">Backup created: ${esc(data.filename)}</div>`;
  } catch(err) { showError(err); }
}

async function renderSettings() {
  const settings = await api("/api/settings");
  state.settings = settings;

  document.getElementById("content").innerHTML = `
    <form id="settingsForm" class="card">
      <div class="grid grid-2">
        <label>Company Name<input name="companyName" value="${esc(settings.companyName || "")}"></label>
        <label>Company GSTIN<input name="companyGSTIN" value="${esc(settings.companyGSTIN || "")}"></label>
        <label>Company State<input name="companyState" value="${esc(settings.companyState || "")}"></label>
        <label>Company City<input name="companyCity" value="${esc(settings.companyCity || "")}"></label>
        <label>Currency<input name="currency" value="${esc(settings.currency || "INR")}"></label>
        <label>Date Format<input name="dateFormat" value="${esc(settings.dateFormat || "DD/MM/YYYY")}"></label>
        <label>Invoice Prefix<input name="invoicePrefix" value="${esc(settings.invoicePrefix || "INV")}"></label>
        <label>Quotation Prefix<input name="quotationPrefix" value="${esc(settings.quotationPrefix || "QUO")}"></label>
        <label>Job Prefix<input name="jobPrefix" value="${esc(settings.jobPrefix || "JOB")}"></label>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save Settings</button>
      </div>
    </form>
  `;

  document.getElementById("settingsForm").addEventListener("submit",async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());

    try {
      state.settings = await api("/api/settings",{
        method:"PUT",
        body:JSON.stringify(data)
      });
      toast("Settings saved");
    } catch(err) { showError(err); }
  });
}

async function renderAudit() {
  const rows = await api("/api/audit");

  state.records.audit = rows;

  document.getElementById("content").innerHTML = `
    <div class="page-actions">
      <div class="left"><input class="search" id="auditSearch" placeholder="Search audit log..." oninput="filterTable('audit',this.value)"></div>
      <div class="right"><button class="btn btn-secondary" onclick='exportCSV("audit")'>Export CSV</button></div>
    </div>
    <div id="tableArea">
      ${rows.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Entity ID</th><th>User</th><th>IP</th><th>Details</th></tr></thead>
          <tbody>${rows.map(x => `
            <tr>
              <td>${fmtDateTime(x.createdAt)}</td>
              <td>${badge(x.action)}</td>
              <td>${esc(x.entity)}</td>
              <td>${esc(x.entityId || "—")}</td>
              <td>${esc(lookup("user",x.userId))}</td>
              <td>${esc(x.ipAddress || "—")}</td>
              <td>${esc(x.details || "")}</td>
            </tr>
          `).join("")}</tbody>
        </table></div>
      ` : `<div class="empty">No audit records.</div>`}
    </div>
  `;
}

async function renderPage() {
  const labels = {};

  NAV.forEach(group => group[1].forEach(x => labels[x[0]] = x[2]));

  document.getElementById("pageTitle").textContent = labels[state.page] || "HSPC ERP";
  document.getElementById("userName").textContent = state.user.name || state.user.username || "User";
  document.getElementById("userRole").textContent = role();
  document.getElementById("userAvatar").textContent =
    String(state.user.name || state.user.username || "U").charAt(0).toUpperCase();

  if (state.page === "dashboard") return renderDashboard();
  if (state.page === "inventory") return renderInventory();
  if (state.page === "schedule") return renderSchedule();
  if (state.page === "reports") return renderReports();
  if (state.page === "backup") return renderBackup();
  if (state.page === "settings") return renderSettings();
  if (state.page === "audit") return renderAudit();

  if (state.page === "dispatch") {
    await renderCRUD("jobs");
    const rows = (state.records.jobs || []).filter(x =>
      ["SCHEDULED","ASSIGNED","IN_PROGRESS"].includes(x.status)
    );
    document.getElementById("tableArea").innerHTML = renderTable("jobs",rows);
    return;
  }

  if (CONFIG[state.page]) {
    return renderCRUD(state.page);
  }

  document.getElementById("content").innerHTML =
    `<div class="card"><h3>Page not found</h3></div>`;
}

async function reloadBootstrap() {
  const data = await api("/api/bootstrap");

  state.settings = data.settings || {};
  state.customers = data.customers || [];
  state.users = data.users || [];
  state.employees = data.employees || [];
  state.products = data.products || [];
  state.suppliers = data.suppliers || [];
  state.branches = data.branches || [];

  localStorage.setItem("hspc_user", JSON.stringify(state.user));
}

async function reloadPageData() {
  try {
    await reloadBootstrap();
    await renderPage();
  } catch(err) {
    showError(err);
  }
}

function openChangePassword() {
  document.getElementById("modalEyebrow").textContent = "ACCOUNT";
  document.getElementById("modalTitle").textContent = "Change Password";

  document.getElementById("modalBody").innerHTML = `
    <form id="passwordForm" class="modal-body">
      <div class="grid grid-2">
        <label>Current Password<input type="password" name="currentPassword" required></label>
        <label>New Password<input type="password" name="newPassword" minlength="6" required></label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Change Password</button>
      </div>
    </form>
  `;

  document.getElementById("passwordForm").addEventListener("submit",async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());

    try {
      await api("/api/change-password",{
        method:"POST",
        body:JSON.stringify(data)
      });

      closeModal();
      toast("Password changed");
    } catch(err) { showError(err); }
  });

  openModal();
}

(async function boot() {
  renderNav();

  try {
    await reloadBootstrap();
    await renderPage();
  } catch(err) {
    showError(err);
  }
})();
