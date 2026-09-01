import { useState, useEffect, useRef, useCallback } from "react";
import * as XLSX from "xlsx";
import { Html5Qrcode } from "html5-qrcode";
import { supabase } from "./supabaseClient";
import {
  ScanLine,
  LayoutGrid,
  ListFilter,
  UploadCloud,
  Plus,
  X,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Search,
  Loader2,
  Settings2,
  FileSpreadsheet,
  Info,
  Ban,
  Download,
  Camera,
} from "lucide-react";

/* ---------------------------------------------------------
   Constants
--------------------------------------------------------- */

const STATUS = {
  PENDING: "Chờ hàng về",
  OVERDUE: "Quá hạn - coi như mất",
  RECEIVED: "Đã nhận",
  DONE: "Hoàn thành",
  NO_ACTION: "Không cần xử lý",
};

const STATUS_STYLE = {
  [STATUS.PENDING]: { bg: "#FBF0DC", fg: "#9A6B12", dot: "#D8922E" },
  [STATUS.OVERDUE]: { bg: "#F7E4E1", fg: "#96362B", dot: "#B5453A" },
  [STATUS.RECEIVED]: { bg: "#E1EEEF", fg: "#265257", dot: "#2F6F76" },
  [STATUS.DONE]: { bg: "#E4EFE7", fg: "#2C5B3D", dot: "#3F7D58" },
  [STATUS.NO_ACTION]: { bg: "#EDEBE5", fg: "#7A7566", dot: "#B0AA98" },
};

const ORDER_TYPES = ["Trả hàng hoàn tiền", "Bùng đơn", "Đơn huỷ", "Giao không thành công"];
const ACTUAL_CONDITIONS = ["Hàng lỗi,hỏng", "Thiếu hàng", "Sai hàng", "Khác"];
const SOLUTION_PLANS = ["Hoàn tiền ngay", "Trả hàng & Hoàn tiền", "Lên đơn ngoài", "Khác"];

/* ---------------------------------------------------------
   Helpers
--------------------------------------------------------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fmtDate(iso, withTime = true) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  const p2 = (n) => String(n).padStart(2, "0");
  const base = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`;
  if (!withTime) return base;
  return `${base} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

function fmtMoney(n) {
  if (n === undefined || n === null || n === "" || isNaN(n)) return "—";
  return Number(n).toLocaleString("vi-VN") + "đ";
}

function monthLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return "T" + String(d.getMonth() + 1).padStart(2, "0");
}

function toISO(v) {
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d)) return d.toISOString();
  }
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v);
    if (!isNaN(d)) return d.toISOString();
  }
  return new Date().toISOString();
}

function toStorageSafeName(name) {
  const dot = name.lastIndexOf(".");
  const base = dot > -1 ? name.slice(0, dot) : name;
  const ext = dot > -1 ? name.slice(dot) : "";
  const safeBase = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
  return safeBase + ext;
}

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

// TikTok exports "82.912₫" (dấu chấm là phân cách nghìn, không phải thập phân)
function toNumberTiktokVND(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d]/g, ""));
  return isNaN(n) ? null : n;
}

// TikTok xuất ngày giờ dạng chuỗi "DD/MM/YYYY HH:mm:ss" mà new Date() không tự đọc đúng
function toISOTiktok(v) {
  if (typeof v === "string") {
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) {
      const [, d, mo, y, h, mi, s] = m;
      const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
      if (!isNaN(dt)) return dt.toISOString();
    }
  }
  return toISO(v);
}

function getEffectiveStatus(rec, overdueDays) {
  if (
    rec.status === STATUS.RECEIVED ||
    rec.status === STATUS.DONE ||
    rec.status === STATUS.NO_ACTION
  ) {
    return rec.status;
  }
  const req = new Date(rec.requestDate).getTime();
  if (!isNaN(req) && Date.now() - req > overdueDays * 86400000) {
    return STATUS.OVERDUE;
  }
  return STATUS.PENDING;
}

/* ---------------------------------------------------------
   Supabase <-> app record mappers
--------------------------------------------------------- */

function rowToRecord(row) {
  return {
    id: row.id,
    orderCode: row.order_code,
    sku: row.sku,
    productName: row.product_name,
    requestDate: row.request_date,
    quantity: row.quantity,
    orderType: row.order_type,
    reason: row.reason,
    solutionPlan: row.solution_plan,
    amount: row.amount,
    status: row.status,
    needsPhysicalReturn: row.needs_physical_return,
    readyToScan: row.ready_to_scan,
    source: row.source,
    receivedDate: row.received_date,
    itemCondition: row.item_condition,
    month: row.month,
    shop: row.shop,
  };
}

function recordToRow(rec) {
  return {
    id: rec.id,
    order_code: rec.orderCode,
    sku: rec.sku || null,
    product_name: rec.productName || null,
    request_date: rec.requestDate || null,
    quantity: rec.quantity ?? null,
    order_type: rec.orderType || null,
    reason: rec.reason || null,
    solution_plan: rec.solutionPlan || null,
    amount: rec.amount ?? null,
    status: rec.status,
    needs_physical_return: !!rec.needsPhysicalReturn,
    ready_to_scan: !!rec.readyToScan,
    source: rec.source || null,
    received_date: rec.receivedDate || null,
    item_condition: rec.itemCondition || null,
    month: rec.month || null,
    shop: rec.shop || null,
  };
}

/* ---------------------------------------------------------
   Shopee file parsing + classification
--------------------------------------------------------- */

function detectFileType(headerRow) {
  const h = headerRow.map((x) => String(x || "").trim());
  if (h.includes("Lí do Trả hàng/Hoàn tiền") && h.includes("Phương án")) return "return_refund";
  if (h.includes("Lý do hủy")) return "cancelled";
  if (h.includes("Trạng thái trả hàng")) return "failed_delivery";
  if (h.includes("Return Order ID")) return "tiktok_return_refund";
  if (h.includes("Cancelation/Return Type")) return "tiktok_order_status";
  return "unknown";
}

function parseReturnRefund(rows) {
  const header = rows[0].map((x) => String(x || "").trim());
  const col = (name) => header.indexOf(name);
  const colLast = (name) => header.lastIndexOf(name);

  const iOrder = col("Mã đơn hàng");
  const iSkuA = col("SKU phân loại");
  const iSkuB = col("SKU sản phẩm");
  const iProduct = col("Tên sản phẩm");
  const iReqDate = col("Thời gian khiếu nại");
  const iQty = col("Số lượng Hoàn");
  const iPlan = col("Phương án");
  const iReason = col("Lí do Trả hàng/Hoàn tiền");
  const iAmount = col("Tổng số tiền Hoàn trả");
  const iReturnStatus = colLast("Trạng thái trả hàng");
  const iClaimStatus = col("Trạng thái Trả hàng/Hoàn tiền");

  const out = [];
  for (const r of rows.slice(1)) {
    if (!r || !r[iOrder]) continue;
    const plan = r[iPlan];
    const returnStatus = r[iReturnStatus];
    const claimStatus = r[iClaimStatus];
    let status, needsPhysicalReturn, readyToScan, solutionPlan;
    if (claimStatus && claimStatus !== "Đã hoàn tiền cho Người mua") {
      needsPhysicalReturn = false;
      status = STATUS.NO_ACTION;
      readyToScan = false;
      solutionPlan = "Khiếu nại không thành (" + claimStatus + ")";
    } else if (plan === "Trả hàng & Hoàn tiền") {
      needsPhysicalReturn = true;
      status = STATUS.PENDING;
      readyToScan = returnStatus === "Giao hàng hoàn trả thành công";
      solutionPlan = "Trả hàng & Hoàn tiền";
    } else {
      needsPhysicalReturn = false;
      status = STATUS.NO_ACTION;
      readyToScan = false;
      solutionPlan = plan || "Hoàn tiền ngay";
    }
    out.push({
      orderCode: String(r[iOrder]).trim().toUpperCase(),
      sku: r[iSkuA] || r[iSkuB] || "",
      productName: r[iProduct] || "",
      requestDate: toISO(r[iReqDate]),
      quantity: toNumber(r[iQty]) || 1,
      orderType: "Trả hàng hoàn tiền",
      reason: r[iReason] || "",
      solutionPlan,
      amount: toNumber(r[iAmount]),
      status,
      needsPhysicalReturn,
      readyToScan,
      source: "shopee-return_refund",
    });
  }
  return out;
}

function parseCancelled(rows) {
  const header = rows[0].map((x) => String(x || "").trim());
  const col = (name) => header.indexOf(name);

  const iOrder = col("Mã đơn hàng");
  const iTracking = col("Mã Kiện Hàng");
  const iReason = col("Lý do hủy");
  const iSku = col("SKU phân loại hàng");
  const iSkuB = col("SKU sản phẩm");
  const iProduct = col("Tên sản phẩm");
  const iQty = col("Số lượng");
  const iAmount = col("Tổng số tiền Người mua thanh toán");
  const iDate = col("Ngày đặt hàng");

  const out = [];
  for (const r of rows.slice(1)) {
    if (!r || !r[iOrder]) continue;
    const hasTracking = !!r[iTracking];
    const reason = r[iReason] || "";
    let status, needsPhysicalReturn, solutionPlan;
    if (!hasTracking) {
      status = STATUS.NO_ACTION;
      needsPhysicalReturn = false;
      solutionPlan = "Không cần xử lý (huỷ trước khi giao)";
    } else if (reason.includes("Giao hàng thất bại")) {
      status = STATUS.PENDING;
      needsPhysicalReturn = true;
      solutionPlan = "Theo dõi hàng về (giao thất bại)";
    } else {
      status = STATUS.PENDING;
      needsPhysicalReturn = true;
      solutionPlan = "Theo dõi hàng về (huỷ sau khi lấy hàng)";
    }
    out.push({
      orderCode: String(r[iOrder]).trim().toUpperCase(),
      sku: r[iSku] || r[iSkuB] || "",
      productName: r[iProduct] || "",
      requestDate: toISO(r[iDate]),
      quantity: toNumber(r[iQty]) || 1,
      orderType: "Đơn huỷ",
      reason,
      solutionPlan,
      amount: toNumber(r[iAmount]),
      status,
      needsPhysicalReturn,
      readyToScan: false,
      source: "shopee-cancelled",
    });
  }
  return out;
}

function parseFailedDelivery(rows) {
  const header = rows[0].map((x) => String(x || "").trim());
  const col = (name) => header.indexOf(name);

  const iOrder = col("Mã đơn hàng");
  const iStatus = col("Trạng thái trả hàng");
  const iSku = col("SKU phân loại hàng");
  const iSkuB = col("SKU sản phẩm");
  const iProduct = col("Tên sản phẩm");
  const iQty = col("Số lượng");
  const iAmount = col("Tổng số tiền Người mua thanh toán");
  const iDate = col("Ngày đặt hàng");

  const out = [];
  for (const r of rows.slice(1)) {
    if (!r || !r[iOrder]) continue;
    const s = r[iStatus] || "";
    let status, needsPhysicalReturn, readyToScan, solutionPlan;
    if (s.includes("thất lạc")) {
      status = STATUS.OVERDUE;
      needsPhysicalReturn = false;
      readyToScan = false;
      solutionPlan = "Thất lạc - không xử lý";
    } else {
      status = STATUS.PENDING;
      needsPhysicalReturn = true;
      readyToScan = true;
      solutionPlan = "Trả hàng & Hoàn tiền";
    }
    out.push({
      orderCode: String(r[iOrder]).trim().toUpperCase(),
      sku: r[iSku] || r[iSkuB] || "",
      productName: r[iProduct] || "",
      requestDate: toISO(r[iDate]),
      quantity: toNumber(r[iQty]) || 1,
      orderType: "Giao không thành công",
      reason: s || "Giao hàng thất bại",
      solutionPlan,
      amount: toNumber(r[iAmount]),
      status,
      needsPhysicalReturn,
      readyToScan,
      source: "shopee-failed_delivery",
    });
  }
  return out;
}

function parseTiktokReturnRefund(rows) {
  const header = rows[0].map((x) => String(x || "").trim());
  const col = (name) => header.indexOf(name);

  const iOrder = col("Order ID");
  const iSku = col("Seller SKU");
  const iProduct = col("Product Name");
  const iReqDate = col("Time Requested");
  const iQty = col("Return Quantity");
  const iReason = col("Return Reason");
  const iAmount = col("Return unit price");
  const iReturnType = col("Return Type");
  const iReturnStatus = col("Return Status");

  const out = [];
  for (const r of rows.slice(1)) {
    if (!r || !r[iOrder]) continue;
    const returnType = r[iReturnType];
    const returnStatus = r[iReturnStatus];
    let status, needsPhysicalReturn, solutionPlan;
    if (returnStatus && returnStatus !== "Completed") {
      needsPhysicalReturn = false;
      status = STATUS.NO_ACTION;
      solutionPlan = "Khiếu nại không thành (" + returnStatus + ")";
    } else if (returnType === "Return and refund") {
      needsPhysicalReturn = true;
      status = STATUS.PENDING;
      solutionPlan = "Trả hàng & Hoàn tiền";
    } else {
      needsPhysicalReturn = false;
      status = STATUS.NO_ACTION;
      solutionPlan = returnType || "Hoàn tiền ngay";
    }
    out.push({
      orderCode: String(r[iOrder]).trim().toUpperCase(),
      sku: r[iSku] || "",
      productName: r[iProduct] || "",
      requestDate: toISOTiktok(r[iReqDate]),
      quantity: toNumber(r[iQty]) || 1,
      orderType: "Trả hàng hoàn tiền",
      reason: r[iReason] || "",
      solutionPlan,
      amount: toNumberTiktokVND(r[iAmount]),
      status,
      needsPhysicalReturn,
      readyToScan: false,
      source: "tiktok-return_refund",
    });
  }
  return out;
}

// Gộp chung file "Đã huỷ" và "Giao không thành công" của TikTok — hai file có
// cấu trúc giống hệt nhau (sheet "OrderSKUList"), chỉ phân biệt được qua nội
// dung cột "Shipped Time" của từng dòng, không phải qua tên file/tab.
function parseTiktokOrderStatus(rows) {
  const header = rows[0].map((x) => String(x || "").trim());
  const col = (name) => header.indexOf(name);

  const iOrder = col("Order ID");
  const iSku = col("Seller SKU");
  const iProduct = col("Product Name");
  const iQty = col("Quantity");
  const iReason = col("Cancel Reason");
  const iDate = col("Cancelled Time");
  const iAmount = col("SKU Subtotal After Discount");
  const iShipped = col("Shipped Time");

  const out = [];
  for (const r of rows.slice(2)) {
    if (!r || !r[iOrder]) continue;
    const hasShipped = r[iShipped] !== null && r[iShipped] !== undefined && String(r[iShipped]).trim() !== "";
    let status, needsPhysicalReturn, readyToScan, source, orderType, solutionPlan;
    if (!hasShipped) {
      status = STATUS.NO_ACTION;
      needsPhysicalReturn = false;
      readyToScan = false;
      source = "tiktok-cancelled";
      orderType = "Đơn huỷ";
      solutionPlan = "Không cần xử lý (huỷ trước khi giao)";
    } else {
      status = STATUS.PENDING;
      needsPhysicalReturn = true;
      readyToScan = false;
      source = "tiktok-failed_delivery";
      orderType = "Giao không thành công";
      solutionPlan = "Theo dõi hàng về (huỷ sau khi giao)";
    }
    out.push({
      orderCode: String(r[iOrder]).trim().toUpperCase(),
      sku: r[iSku] || "",
      productName: r[iProduct] || "",
      requestDate: toISOTiktok(r[iDate]),
      quantity: toNumber(r[iQty]) || 1,
      orderType,
      reason: r[iReason] || "",
      solutionPlan,
      amount: toNumber(r[iAmount]),
      status,
      needsPhysicalReturn,
      readyToScan,
      source,
    });
  }
  return out;
}

function parseWorkbookRows(rows) {
  if (!rows || !rows.length) return { type: "unknown", records: [] };
  const type = detectFileType(rows[0]);
  if (type === "return_refund") return { type, records: parseReturnRefund(rows) };
  if (type === "cancelled") return { type, records: parseCancelled(rows) };
  if (type === "failed_delivery") return { type, records: parseFailedDelivery(rows) };
  if (type === "tiktok_return_refund") return { type, records: parseTiktokReturnRefund(rows) };
  if (type === "tiktok_order_status") return { type, records: parseTiktokOrderStatus(rows) };
  return { type: "unknown", records: [] };
}

/* ---------------------------------------------------------
   Small UI atoms
--------------------------------------------------------- */

function StatusBadge({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE[STATUS.PENDING];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
      style={{ backgroundColor: s.bg, color: s.fg }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.dot }} />
      {status}
    </span>
  );
}

function StatCard({ label, value, tone, muted }) {
  const s = STATUS_STYLE[tone] || null;
  return (
    <div
      className="flex-1 min-w-[130px] rounded-2xl p-4 border"
      style={{ backgroundColor: muted ? "#F7F5F0" : "#FFFFFF", borderColor: "#E4DFD4" }}
    >
      <div className="text-xs font-medium tracking-wide uppercase" style={{ color: "#8A8375" }}>
        {label}
      </div>
      <div
        className="mt-2 text-2xl font-bold"
        style={{ color: s ? s.dot : "#1B1F27", fontFamily: "'Space Grotesk', sans-serif" }}
      >
        {value}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium" style={{ color: "#4A4638" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 transition-shadow";
const inputStyle = { borderColor: "#E4DFD4", backgroundColor: "#FBFAF7" };

/* ---------------------------------------------------------
   Add Record Modal
--------------------------------------------------------- */

function AddModal({ onClose, onSave, prefillOrderCode }) {
  const [form, setForm] = useState({
    orderCode: prefillOrderCode || "",
    sku: "",
    shop: "ductincandle",
    quantity: 1,
    orderType: ORDER_TYPES[0],
    reason: "",
    actualCondition: ACTUAL_CONDITIONS[0],
    solutionPlan: SOLUTION_PLANS[0],
    amount: "",
    requestDate: new Date().toISOString().slice(0, 16),
  });
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    if (!form.orderCode.trim()) {
      setError("Vui lòng nhập mã đơn hàng.");
      return;
    }
    onSave({
      ...form,
      orderCode: form.orderCode.trim().toUpperCase(),
      quantity: Number(form.quantity) || 1,
      amount: form.amount === "" ? null : Number(form.amount),
      requestDate: new Date(form.requestDate).toISOString(),
      source: "manual",
      needsPhysicalReturn: true,
      readyToScan: false,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(20,18,14,0.45)" }}>
      <div className="w-full max-w-lg rounded-3xl p-6 max-h-[90vh] overflow-y-auto" style={{ backgroundColor: "#FFFFFF" }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#1B1F27" }}>
            Ghi nhận yêu cầu hoàn
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-black/5">
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Mã đơn hàng *">
            <input className={inputCls} style={inputStyle} value={form.orderCode} onChange={set("orderCode")} placeholder="VD: 260601VSBXFJY2" />
          </Field>
          <Field label="SKU">
            <input className={inputCls} style={inputStyle} value={form.sku} onChange={set("sku")} />
          </Field>
          <Field label="Shop">
            <input className={inputCls} style={inputStyle} value={form.shop} onChange={set("shop")} />
          </Field>
          <Field label="Số lượng">
            <input type="number" min="1" className={inputCls} style={inputStyle} value={form.quantity} onChange={set("quantity")} />
          </Field>
          <Field label="Ngày yêu cầu hoàn">
            <input type="datetime-local" className={inputCls} style={inputStyle} value={form.requestDate} onChange={set("requestDate")} />
          </Field>
          <Field label="Loại tình huống">
            <select className={inputCls} style={inputStyle} value={form.orderType} onChange={set("orderType")}>
              {ORDER_TYPES.map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <div className="col-span-2">
            <Field label="Lý do khách hoàn">
              <input className={inputCls} style={inputStyle} value={form.reason} onChange={set("reason")} />
            </Field>
          </div>
          <Field label="Tình trạng thực tế">
            <select className={inputCls} style={inputStyle} value={form.actualCondition} onChange={set("actualCondition")}>
              {ACTUAL_CONDITIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Phương án xử lý">
            <select className={inputCls} style={inputStyle} value={form.solutionPlan} onChange={set("solutionPlan")}>
              {SOLUTION_PLANS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Số tiền hoàn (đ)">
            <input type="number" className={inputCls} style={inputStyle} value={form.amount} onChange={set("amount")} />
          </Field>
        </div>

        {error && <div className="mt-3 text-sm font-medium" style={{ color: "#B5453A" }}>{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ color: "#4A4638" }}>
            Hủy
          </button>
          <button
            onClick={submit}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: "#1B1F27" }}
          >
            Lưu yêu cầu
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Import View (Shopee Excel upload)
--------------------------------------------------------- */

function ImportView({ records, onImport, fileHistory, onRecordFileHistory, onDownloadFile }) {
  const [busy, setBusy] = useState(false);
  const [summaries, setSummaries] = useState([]);
  const [downloadingId, setDownloadingId] = useState(null);
  const fileRef = useRef(null);

  const handleFiles = async (fileList) => {
    setBusy(true);
    const newSummaries = [];
    for (const file of fileList) {
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array", cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
        const { type, records: parsed } = parseWorkbookRows(rows);

        if (type === "unknown") {
          newSummaries.push({ file: file.name, error: "Không nhận diện được định dạng — không giống các file Shopee/TikTok đã biết." });
          continue;
        }

        const result = await onImport(parsed);

        let storageWarning = null;
        try {
          await onRecordFileHistory({
            file,
            fileType: type,
            rowCount: parsed.length,
            addedCount: result.added,
            skippedCount: result.skipped,
          });
        } catch (e) {
          storageWarning = "Đã nhập dữ liệu, nhưng không lưu được bản sao file gốc: " + e.message;
        }

        newSummaries.push({
          file: file.name,
          type,
          total: parsed.length,
          added: result.added,
          skipped: result.skipped,
          needsAction: result.needsAction,
          noAction: result.noAction,
          storageWarning,
        });
      } catch (e) {
        newSummaries.push({ file: file.name, error: "Lỗi đọc file: " + e.message });
      }
    }
    setSummaries(newSummaries);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDownload = async (entry) => {
    setDownloadingId(entry.id);
    await onDownloadFile(entry);
    setDownloadingId(null);
  };

  const typeLabel = {
    return_refund: "Trả hàng hoàn tiền (Shopee)",
    cancelled: "Đơn huỷ (Shopee)",
    failed_delivery: "Giao không thành công (Shopee)",
    tiktok_return_refund: "Trả hàng hoàn tiền (TikTok)",
    tiktok_order_status: "Đơn huỷ / Giao không thành công (TikTok)",
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-3xl p-6 border-2 border-dashed flex flex-col items-center text-center" style={{ borderColor: "#2F6F76", backgroundColor: "#FFFFFF" }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: "#1B1F27" }}>
          <UploadCloud size={22} color="#F3EFE4" />
        </div>
        <h2 className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#1B1F27" }}>
          Nhập file từ Shopee & TikTok
        </h2>
        <p className="text-sm mt-1 max-w-md" style={{ color: "#7A7566" }}>
          Kéo thả hoặc chọn file <b>Order return_refund</b>, <b>Order cancelled</b>, <b>Order failed_delivery</b> tải từ Kênh Người Bán Shopee, hoặc <b>Đơn trả hàng/hoàn tiền</b>, <b>Đơn huỷ</b>, <b>Giao không thành công</b> tải từ TikTok Shop (.xlsx/.xls). App tự nhận diện loại file và phân loại đơn nào cần theo dõi vật lý.
        </p>
        <label className="mt-4 px-5 py-2.5 rounded-xl text-sm font-semibold text-white cursor-pointer" style={{ backgroundColor: "#1B1F27" }}>
          {busy ? "Đang xử lý..." : "Chọn file Excel"}
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".xlsx,.xls"
            className="hidden"
            disabled={busy}
            onChange={(e) => e.target.files.length && handleFiles(Array.from(e.target.files))}
          />
        </label>
      </div>

      <div className="rounded-2xl border px-4 py-3 flex gap-2.5" style={{ borderColor: "#E4DFD4", backgroundColor: "#FFFFFF" }}>
        <Info size={16} className="flex-shrink-0 mt-0.5" style={{ color: "#8A8375" }} />
        <div className="text-sm" style={{ color: "#4A4638" }}>
          <b>Nên tải theo thứ tự:</b> Trả hàng hoàn tiền → Giao không thành công → Đơn huỷ (tải cuối để tránh trùng với các đơn huỷ-do-giao-thất-bại đã có trong file Giao không thành công).
          Đơn đã tồn tại (theo mã đơn + SKU) sẽ được bỏ qua, không ghi đè.
        </div>
      </div>

      {summaries.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: "#8A8375" }}>
            Kết quả nhập
          </h3>
          {summaries.map((s, i) => (
            <div key={i} className="rounded-2xl border px-4 py-3" style={{ borderColor: "#E4DFD4", backgroundColor: "#FFFFFF" }}>
              <div className="flex items-center gap-2 mb-1">
                <FileSpreadsheet size={15} style={{ color: "#2F6F76" }} />
                <span className="text-sm font-semibold" style={{ color: "#1B1F27" }}>{s.file}</span>
              </div>
              {s.error ? (
                <div className="text-sm flex items-center gap-1.5" style={{ color: "#B5453A" }}>
                  <Ban size={14} /> {s.error}
                </div>
              ) : (
                <div className="text-sm" style={{ color: "#4A4638" }}>
                  Loại: <b>{typeLabel[s.type]}</b> · Đọc được {s.total} dòng → thêm mới <b>{s.added}</b>, bỏ qua (đã có) {s.skipped}.
                  <br />
                  Trong số thêm mới: <b style={{ color: "#9A6B12" }}>{s.needsAction} đơn cần theo dõi hàng về</b>, {s.noAction} đơn không cần xử lý (đã tự động phân loại).
                  {s.storageWarning && (
                    <div className="mt-1.5 flex items-center gap-1.5" style={{ color: "#9A6B12" }}>
                      <Info size={13} /> {s.storageWarning}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide mb-2" style={{ color: "#8A8375" }}>
          Đã nhập trong hệ thống
        </h3>
        <div className="flex flex-wrap gap-3 text-sm">
          {[
            "shopee-return_refund",
            "shopee-cancelled",
            "shopee-failed_delivery",
            "tiktok-return_refund",
            "tiktok-cancelled",
            "tiktok-failed_delivery",
          ].map((src) => {
            const n = records.filter((r) => r.source === src).length;
            return (
              <div key={src} className="rounded-xl border px-3 py-2" style={{ borderColor: "#E4DFD4", backgroundColor: "#FFFFFF", color: "#4A4638" }}>
                {src === "shopee-return_refund" && "Trả hàng hoàn tiền (Shopee)"}
                {src === "shopee-cancelled" && "Đơn huỷ (Shopee)"}
                {src === "shopee-failed_delivery" && "Giao không thành công (Shopee)"}
                {src === "tiktok-return_refund" && "Trả hàng hoàn tiền (TikTok)"}
                {src === "tiktok-cancelled" && "Đơn huỷ (TikTok)"}
                {src === "tiktok-failed_delivery" && "Giao không thành công (TikTok)"}
                : <b>{n}</b>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide mb-2" style={{ color: "#8A8375" }}>
          Lịch sử file đã tải
        </h3>
        <div className="flex flex-col gap-2">
          {(!fileHistory || fileHistory.length === 0) && (
            <div className="text-sm rounded-2xl border border-dashed p-4 text-center" style={{ borderColor: "#E4DFD4", color: "#B0AA98" }}>
              Chưa có file nào được lưu lại.
            </div>
          )}
          {(fileHistory || []).map((h) => (
            <div key={h.id} className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3 border" style={{ backgroundColor: "#FFFFFF", borderColor: "#E4DFD4" }}>
              <div className="flex items-center gap-3 min-w-0">
                <FileSpreadsheet size={16} style={{ color: "#2F6F76", flexShrink: 0 }} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: "#1B1F27" }}>{h.file_name}</div>
                  <div className="text-xs" style={{ color: "#8A8375" }}>
                    {typeLabel[h.file_type] || h.file_type} · {h.row_count} dòng · {fmtDate(h.uploaded_at)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleDownload(h)}
                disabled={downloadingId === h.id}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: "#1B1F27", color: "#F3EFE4" }}
              >
                <Download size={13} /> {downloadingId === h.id ? "Đang tải..." : "Tải lại"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Scan View
--------------------------------------------------------- */

const CAMERA_REGION_ID = "scan-camera-region";

function ScanView({ records, overdueDays, onResolveScan, onQuickAdd }) {
  const [code, setCode] = useState("");
  const [pendingGroup, setPendingGroup] = useState(null);
  const [feed, setFeed] = useState([]);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const inputRef = useRef(null);
  const html5QrcodeRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [pendingGroup]);

  const focusInput = () => setTimeout(() => inputRef.current?.focus(), 30);

  const pushFeed = (entry) => setFeed((f) => [{ id: uid(), time: new Date().toISOString(), ...entry }, ...f].slice(0, 10));

  const processCode = (raw) => {
    const normalized = String(raw || "").trim().toUpperCase();
    if (!normalized) return;
    const matches = records.filter((r) => r.orderCode.toUpperCase() === normalized);

    if (matches.length === 0) {
      pushFeed({ kind: "notfound", orderCode: normalized });
      focusInput();
      return;
    }

    const effs = matches.map((m) => getEffectiveStatus(m, overdueDays));
    const pendingOnes = matches.filter((_, i) => effs[i] === STATUS.PENDING || effs[i] === STATUS.OVERDUE);

    if (pendingOnes.length === 0) {
      const anyNoAction = effs.some((e) => e === STATUS.NO_ACTION);
      if (anyNoAction) {
        pushFeed({ kind: "no_action", orderCode: normalized });
      } else {
        pushFeed({ kind: "already", orderCode: normalized, record: matches[0] });
      }
      focusInput();
      return;
    }
    setPendingGroup(pendingOnes);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const raw = code.trim();
    setCode("");
    if (!raw) return;
    processCode(raw);
  };

  const chooseCondition = (condition) => {
    onResolveScan(pendingGroup.map((r) => r.id), condition);
    pushFeed({ kind: "success", orderCode: pendingGroup[0].orderCode, condition, count: pendingGroup.length });
    setPendingGroup(null);
    focusInput();
  };

  // Dừng camera ngay khi có kết quả cần chọn tình trạng hàng (chuyển màn hình)
  useEffect(() => {
    if (pendingGroup) setCameraActive(false);
  }, [pendingGroup]);

  // Mở/tắt camera theo cameraActive; luôn dọn camera khi tắt hoặc khi ScanView unmount
  useEffect(() => {
    if (!cameraActive) return undefined;
    setCameraError("");
    const qr = new Html5Qrcode(CAMERA_REGION_ID);
    html5QrcodeRef.current = qr;

    qr.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        // Tắt camera ngay để không quét lặp lại cùng 1 mã khi camera vẫn đang chĩa vào tem
        const instance = html5QrcodeRef.current;
        html5QrcodeRef.current = null;
        const finish = () => {
          setCameraActive(false);
          processCode(decodedText);
        };
        if (instance) {
          instance.stop().then(() => instance.clear?.()).catch(() => {}).finally(finish);
        } else {
          finish();
        }
      },
      () => {} // bỏ qua các khung hình chưa đọc được mã, không phải lỗi
    ).catch(() => {
      html5QrcodeRef.current = null;
      setCameraError("Không mở được camera — kiểm tra đã cho phép quyền camera chưa, hoặc thiết bị không có camera.");
    });

    return () => {
      const instance = html5QrcodeRef.current;
      html5QrcodeRef.current = null;
      if (instance) {
        instance.stop().then(() => instance.clear?.()).catch(() => {});
      }
    };
  }, [cameraActive]);

  return (
    <div className="flex flex-col gap-5">
      <div
        className="rounded-3xl p-6 border-2 border-dashed flex flex-col items-center text-center"
        style={{ borderColor: pendingGroup ? "#D8922E" : "#2F6F76", backgroundColor: "#FFFFFF" }}
      >
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-3" style={{ backgroundColor: "#1B1F27" }}>
          <ScanLine size={22} color="#F3EFE4" />
        </div>
        <h2 className="text-lg font-bold" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#1B1F27" }}>
          Quét nhận hàng
        </h2>
        <p className="text-sm mt-1 max-w-sm" style={{ color: "#7A7566" }}>
          Đưa con trỏ vào ô bên dưới rồi quét mã đơn hàng bằng máy quét (USB/Bluetooth). Mã sẽ tự động điền và xác nhận.
        </p>

        {!pendingGroup && !cameraActive && (
          <div className="w-full max-w-sm mt-4">
            <form onSubmit={handleSubmit}>
              <input
                ref={inputRef}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Chờ quét mã đơn hàng..."
                className="w-full text-center text-lg font-semibold tracking-wide rounded-2xl border-2 px-4 py-3 outline-none"
                style={{ borderColor: "#2F6F76", fontFamily: "'IBM Plex Mono', monospace", color: "#1B1F27" }}
              />
            </form>
            <button
              type="button"
              onClick={() => setCameraActive(true)}
              className="mt-3 w-full rounded-2xl py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
              style={{ backgroundColor: "#F3EFE4", color: "#1B1F27" }}
            >
              <Camera size={16} /> Quét bằng camera điện thoại
            </button>
          </div>
        )}

        {!pendingGroup && cameraActive && (
          <div className="w-full max-w-sm mt-4">
            <div
              id={CAMERA_REGION_ID}
              className="w-full rounded-2xl overflow-hidden"
              style={{ border: "2px solid #2F6F76", minHeight: 220, backgroundColor: "#1B1F27" }}
            />
            {cameraError && (
              <div className="mt-2 text-sm font-medium" style={{ color: "#B5453A" }}>
                {cameraError}
              </div>
            )}
            <button
              type="button"
              onClick={() => setCameraActive(false)}
              className="mt-3 w-full rounded-2xl py-2.5 text-sm font-semibold text-white"
              style={{ backgroundColor: "#1B1F27" }}
            >
              Dừng quét
            </button>
          </div>
        )}

        {pendingGroup && (
          <div className="w-full max-w-sm mt-4">
            <div
              className="rounded-2xl px-4 py-3 mb-3 text-sm font-semibold"
              style={{ backgroundColor: "#FBF0DC", color: "#9A6B12" }}
            >
              <div style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{pendingGroup[0].orderCode}</div>
              <div className="font-normal mt-1 text-xs">
                {pendingGroup.map((p) => p.sku || "chưa có SKU").join(", ")}
                {pendingGroup[0].readyToScan && " · Shopee xác nhận đã giao hoàn về"}
              </div>
            </div>
            <p className="text-sm font-medium mb-2" style={{ color: "#4A4638" }}>
              Chọn tình trạng hàng vừa mở ra:
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => chooseCondition("Dùng được")}
                className="flex-1 rounded-2xl py-3 font-semibold text-white flex items-center justify-center gap-2"
                style={{ backgroundColor: "#3F7D58" }}
              >
                <CheckCircle2 size={18} /> Dùng được
              </button>
              <button
                onClick={() => chooseCondition("Hỏng")}
                className="flex-1 rounded-2xl py-3 font-semibold text-white flex items-center justify-center gap-2"
                style={{ backgroundColor: "#B5453A" }}
              >
                <AlertTriangle size={18} /> Hỏng
              </button>
            </div>
            <button onClick={() => { setPendingGroup(null); focusInput(); }} className="mt-3 text-sm font-medium underline" style={{ color: "#7A7566" }}>
              Hủy, quét nhầm
            </button>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide mb-2" style={{ color: "#8A8375" }}>
          Vừa quét
        </h3>
        <div className="flex flex-col gap-2">
          {feed.length === 0 && (
            <div className="text-sm rounded-2xl border border-dashed p-4 text-center" style={{ borderColor: "#E4DFD4", color: "#B0AA98" }}>
              Chưa có lượt quét nào.
            </div>
          )}
          {feed.map((f) => (
            <div
              key={f.id}
              className="rounded-2xl px-4 py-3 flex items-center justify-between border"
              style={{ backgroundColor: "#FFFFFF", borderColor: "#E4DFD4" }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor:
                      f.kind === "success" ? "#3F7D58" : f.kind === "notfound" ? "#B5453A" : "#D8922E",
                  }}
                />
                <div>
                  <div className="text-sm font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#1B1F27" }}>
                    {f.orderCode}
                  </div>
                  <div className="text-xs" style={{ color: "#8A8375" }}>
                    {f.kind === "success" && `Đã nhận · ${f.condition}${f.count > 1 ? ` · ${f.count} dòng` : ""}`}
                    {f.kind === "notfound" && "Không tìm thấy trong hệ thống"}
                    {f.kind === "already" && `Đã quét trước đó lúc ${fmtDate(f.record.receivedDate)}`}
                    {f.kind === "no_action" && "Đơn này không cần nhận hàng vật lý (đã hoàn tiền ngay / huỷ trước khi giao)"}
                    {" · " + fmtDate(f.time)}
                  </div>
                </div>
              </div>
              {f.kind === "notfound" && (
                <button
                  onClick={() => onQuickAdd(f.orderCode)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-full"
                  style={{ backgroundColor: "#1B1F27", color: "#F3EFE4" }}
                >
                  + Thêm mới
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   List View
--------------------------------------------------------- */

function ListView({ records, overdueDays, onComplete }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("Tất cả");

  const filtered = records
    .filter((r) => {
      const eff = getEffectiveStatus(r, overdueDays);
      if (statusFilter !== "Tất cả" && eff !== statusFilter) return false;
      if (q.trim()) {
        const s = q.trim().toLowerCase();
        return r.orderCode.toLowerCase().includes(s) || (r.sku || "").toLowerCase().includes(s);
      }
      return true;
    })
    .sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#B0AA98" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm theo mã đơn hoặc SKU..."
            className={inputCls}
            style={{ ...inputStyle, paddingLeft: "2.25rem" }}
          />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls} style={{ ...inputStyle, width: "auto" }}>
          <option>Tất cả</option>
          {Object.values(STATUS).map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: "#E4DFD4", backgroundColor: "#FFFFFF" }}>
        <table className="w-full text-sm min-w-[950px]">
          <thead>
            <tr className="text-left" style={{ backgroundColor: "#F6F3EC" }}>
              {["Mã đơn", "SKU", "Ngày yêu cầu", "Loại tình huống", "Phương án", "Số tiền", "Trạng thái", "Ngày nhận", "Tình trạng", ""].map((h) => (
                <th key={h} className="px-3 py-2.5 font-semibold text-xs uppercase tracking-wide" style={{ color: "#8A8375" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const eff = getEffectiveStatus(r, overdueDays);
              return (
                <tr key={r.id} className="border-t" style={{ borderColor: "#EFEBE1" }}>
                  <td className="px-3 py-2.5 font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#1B1F27" }}>
                    {r.orderCode}
                    {r.readyToScan && eff === STATUS.PENDING && (
                      <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full align-middle" style={{ backgroundColor: "#3F7D58" }} title="Shopee xác nhận đã giao hoàn về" />
                    )}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: "#4A4638" }}>{r.sku || "—"}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#4A4638" }}>{fmtDate(r.requestDate)}</td>
                  <td className="px-3 py-2.5" style={{ color: "#4A4638" }}>{r.orderType}</td>
                  <td className="px-3 py-2.5" style={{ color: "#4A4638" }}>{r.solutionPlan}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#4A4638" }}>{fmtMoney(r.amount)}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={eff} /></td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: "#4A4638" }}>{fmtDate(r.receivedDate)}</td>
                  <td className="px-3 py-2.5" style={{ color: "#4A4638" }}>{r.itemCondition || "—"}</td>
                  <td className="px-3 py-2.5">
                    {eff === STATUS.RECEIVED && (
                      <button
                        onClick={() => onComplete(r.id)}
                        className="text-xs font-semibold px-2.5 py-1.5 rounded-full whitespace-nowrap"
                        style={{ backgroundColor: "#E4EFE7", color: "#2C5B3D" }}
                      >
                        Đánh dấu xong
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center" style={{ color: "#B0AA98" }}>
                  Không có bản ghi nào khớp.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Dashboard View
--------------------------------------------------------- */

function DashboardView({ records, overdueDays, setOverdueDays }) {
  const eff = records.map((r) => getEffectiveStatus(r, overdueDays));
  const counts = {
    total: records.length,
    pending: eff.filter((s) => s === STATUS.PENDING).length,
    overdue: eff.filter((s) => s === STATUS.OVERDUE).length,
    received: eff.filter((s) => s === STATUS.RECEIVED).length,
    done: eff.filter((s) => s === STATUS.DONE).length,
    noAction: eff.filter((s) => s === STATUS.NO_ACTION).length,
  };
  const lostValue = records
    .filter((r, i) => eff[i] === STATUS.OVERDUE)
    .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const readyCount = records.filter((r, i) => eff[i] === STATUS.PENDING && r.readyToScan).length;

  const recent = [...records].sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate)).slice(0, 6);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        <StatCard label="Tổng số ghi nhận" value={counts.total} />
        <StatCard label="Chờ hàng về" value={counts.pending} tone={STATUS.PENDING} />
        <StatCard label="Quá hạn / mất" value={counts.overdue} tone={STATUS.OVERDUE} />
        <StatCard label="Đã nhận, chờ xử lý" value={counts.received} tone={STATUS.RECEIVED} />
        <StatCard label="Hoàn thành" value={counts.done} tone={STATUS.DONE} />
        <StatCard label="Không cần xử lý" value={counts.noAction} tone={STATUS.NO_ACTION} muted />
      </div>

      {readyCount > 0 && (
        <div className="rounded-2xl border px-4 py-3 flex items-center gap-3" style={{ borderColor: "#CFE4CB", backgroundColor: "#EFF7EC" }}>
          <CheckCircle2 size={18} style={{ color: "#3F7D58" }} />
          <div className="text-sm" style={{ color: "#2C5B3D" }}>
            <b>{readyCount} đơn</b> Shopee đã xác nhận giao hoàn về — có thể đã có hàng ở kho, ưu tiên quét trước.
          </div>
        </div>
      )}

      {counts.overdue > 0 && (
        <div className="rounded-2xl border px-4 py-3 flex items-center gap-3" style={{ borderColor: "#F0C9C3", backgroundColor: "#FBF0EE" }}>
          <AlertTriangle size={18} style={{ color: "#B5453A" }} />
          <div className="text-sm" style={{ color: "#96362B" }}>
            <b>{counts.overdue} đơn</b> quá hạn hoặc thất lạc, tổng giá trị coi như mất khoảng <b>{fmtMoney(lostValue)}</b>.
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 text-sm rounded-2xl border px-4 py-3 w-fit" style={{ borderColor: "#E4DFD4", backgroundColor: "#FFFFFF" }}>
        <Settings2 size={16} style={{ color: "#8A8375" }} />
        <span style={{ color: "#4A4638" }}>Ngưỡng quá hạn:</span>
        <input
          type="number"
          min="1"
          value={overdueDays}
          onChange={(e) => setOverdueDays(Number(e.target.value) || 1)}
          className="w-16 rounded-lg border px-2 py-1 text-center"
          style={inputStyle}
        />
        <span style={{ color: "#4A4638" }}>ngày kể từ ngày yêu cầu</span>
      </div>

      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide mb-2" style={{ color: "#8A8375" }}>
          Yêu cầu gần đây
        </h3>
        <div className="flex flex-col gap-2">
          {recent.length === 0 && (
            <div className="text-sm rounded-2xl border border-dashed p-4 text-center" style={{ borderColor: "#E4DFD4", color: "#B0AA98" }}>
              Chưa có dữ liệu. Bấm "Thêm yêu cầu" hoặc vào "Nhập từ Shopee" để bắt đầu.
            </div>
          )}
          {recent.map((r) => (
            <div key={r.id} className="rounded-2xl px-4 py-3 flex items-center justify-between border" style={{ backgroundColor: "#FFFFFF", borderColor: "#E4DFD4" }}>
              <div>
                <div className="text-sm font-semibold" style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#1B1F27" }}>
                  {r.orderCode} <span style={{ color: "#B0AA98", fontFamily: "inherit" }}>· {r.sku}</span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: "#8A8375" }}>
                  {r.reason || "Không rõ lý do"} · {fmtDate(r.requestDate)}
                </div>
              </div>
              <StatusBadge status={getEffectiveStatus(r, overdueDays)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------
   Main App
--------------------------------------------------------- */

export default function App() {
  const [records, setRecords] = useState([]);
  const [overdueDays, setOverdueDaysState] = useState(15);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [showAdd, setShowAdd] = useState(false);
  const [prefillCode, setPrefillCode] = useState("");
  const [saveError, setSaveError] = useState("");
  const [fileHistory, setFileHistory] = useState([]);

  const recordsRef = useRef(records);
  recordsRef.current = records;

  // Load from Supabase on mount
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("hang_hoan_returns").select("*");
      if (error) {
        setSaveError("Không tải được dữ liệu từ Supabase: " + error.message);
      } else {
        setRecords((data || []).map(rowToRecord));
      }

      const { data: settingsRow } = await supabase
        .from("hang_hoan_settings")
        .select("value")
        .eq("key", "overdue_days")
        .maybeSingle();
      if (settingsRow?.value) setOverdueDaysState(Number(settingsRow.value) || 15);

      const { data: historyData } = await supabase
        .from("hang_hoan_file_history")
        .select("*")
        .order("uploaded_at", { ascending: false });
      setFileHistory(historyData || []);

      setLoading(false);
    })();
  }, []);

  const recordFileHistory = async ({ file, fileType, rowCount, addedCount, skippedCount }) => {
    const storagePath = `imports/${Date.now()}-${toStorageSafeName(file.name)}`;
    const { error: uploadError } = await supabase.storage
      .from("hang-hoan-files")
      .upload(storagePath, file, { contentType: file.type || "application/octet-stream" });
    if (uploadError) throw uploadError;

    const entry = {
      id: uid(),
      file_name: file.name,
      file_type: fileType,
      storage_path: storagePath,
      row_count: rowCount,
      added_count: addedCount,
      skipped_count: skippedCount,
      uploaded_at: new Date().toISOString(),
    };
    const { error: insertError } = await supabase.from("hang_hoan_file_history").insert(entry);
    if (insertError) throw insertError;
    setFileHistory((prev) => [entry, ...prev]);
  };

  const downloadFile = async (entry) => {
    const { data, error } = await supabase.storage.from("hang-hoan-files").download(entry.storage_path);
    if (error) {
      setSaveError("Không tải được file: " + error.message);
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = entry.file_name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const setOverdueDays = useCallback(async (days) => {
    setOverdueDaysState(days);
    const { error } = await supabase
      .from("hang_hoan_settings")
      .upsert({ key: "overdue_days", value: days });
    if (error) setSaveError("Không lưu được ngưỡng quá hạn: " + error.message);
  }, []);

  const addRecord = async (formData) => {
    const newRecord = {
      id: uid(),
      ...formData,
      month: monthLabel(formData.requestDate),
      status: STATUS.PENDING,
      receivedDate: null,
      itemCondition: null,
    };
    const { error } = await supabase.from("hang_hoan_returns").insert(recordToRow(newRecord));
    if (error) {
      setSaveError("Không lưu được yêu cầu mới: " + error.message);
      return;
    }
    setSaveError("");
    setRecords((prev) => [...prev, newRecord]);
    setShowAdd(false);
    setPrefillCode("");
  };

  // Bulk import from a parsed Shopee file; dedupes by orderCode+sku
  const importRecords = async (parsed) => {
    const existingKeys = new Set(
      recordsRef.current.map((r) => (r.orderCode + "::" + (r.sku || "")).toUpperCase())
    );
    let added = 0, skipped = 0, needsAction = 0, noAction = 0;
    const toAdd = [];
    for (const p of parsed) {
      const key = (p.orderCode + "::" + (p.sku || "")).toUpperCase();
      if (existingKeys.has(key)) {
        skipped++;
        continue;
      }
      existingKeys.add(key);
      added++;
      if (p.status === STATUS.NO_ACTION) noAction++;
      else needsAction++;
      toAdd.push({
        id: uid(),
        ...p,
        month: monthLabel(p.requestDate),
        receivedDate: null,
        itemCondition: null,
      });
    }
    if (toAdd.length) {
      const { error } = await supabase.from("hang_hoan_returns").insert(toAdd.map(recordToRow));
      if (error) {
        setSaveError("Không lưu được dữ liệu nhập: " + error.message);
        return { added: 0, skipped, needsAction: 0, noAction: 0 };
      }
      setSaveError("");
      setRecords((prev) => [...prev, ...toAdd]);
    }
    return { added, skipped, needsAction, noAction };
  };

  const resolveScan = async (ids, condition) => {
    const receivedDate = new Date().toISOString();
    const { error } = await supabase
      .from("hang_hoan_returns")
      .update({ status: STATUS.RECEIVED, received_date: receivedDate, item_condition: condition })
      .in("id", ids);
    if (error) {
      setSaveError("Không lưu được kết quả quét: " + error.message);
      return;
    }
    setSaveError("");
    const idSet = new Set(ids);
    setRecords((prev) =>
      prev.map((r) =>
        idSet.has(r.id) ? { ...r, status: STATUS.RECEIVED, receivedDate, itemCondition: condition } : r
      )
    );
  };

  const markComplete = async (id) => {
    const { error } = await supabase.from("hang_hoan_returns").update({ status: STATUS.DONE }).eq("id", id);
    if (error) {
      setSaveError("Không cập nhật được: " + error.message);
      return;
    }
    setSaveError("");
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, status: STATUS.DONE } : r)));
  };

  const NAV = [
    { key: "dashboard", label: "Tổng quan", icon: LayoutGrid },
    { key: "scan", label: "Quét nhận hàng", icon: ScanLine },
    { key: "import", label: "Nhập từ Shopee", icon: UploadCloud },
    { key: "list", label: "Danh sách", icon: ListFilter },
  ];

  return (
    <div className="min-h-screen w-full" style={{ backgroundColor: "#F1EEE7", fontFamily: "'Manrope', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700&family=Manrope:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap');
        input:focus, select:focus { box-shadow: 0 0 0 3px rgba(47,111,118,0.18); border-color: #2F6F76 !important; }
      `}</style>

      <div className="max-w-4xl mx-auto px-4 py-6 flex flex-col gap-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: "#1B1F27" }}>
              <Flame size={18} color="#E8A33D" />
            </div>
            <div>
              <div className="text-sm font-bold leading-tight" style={{ fontFamily: "'Space Grotesk', sans-serif", color: "#1B1F27" }}>
                DUCTIN CANDLE
              </div>
              <div className="text-xs leading-tight" style={{ color: "#8A8375" }}>
                Kiểm soát hàng hoàn
              </div>
            </div>
          </div>
          <button
            onClick={() => { setPrefillCode(""); setShowAdd(true); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: "#1B1F27" }}
          >
            <Plus size={16} /> Thêm yêu cầu
          </button>
        </div>

        <div className="flex gap-1.5 p-1 rounded-2xl w-fit flex-wrap" style={{ backgroundColor: "#E9E4D8" }}>
          {NAV.map((n) => {
            const Icon = n.icon;
            const active = view === n.key;
            return (
              <button
                key={n.key}
                onClick={() => setView(n.key)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-sm font-semibold transition-colors"
                style={{
                  backgroundColor: active ? "#FFFFFF" : "transparent",
                  color: active ? "#1B1F27" : "#8A8375",
                  boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                }}
              >
                <Icon size={15} /> {n.label}
              </button>
            );
          })}
        </div>

        {saveError && (
          <div className="text-sm rounded-xl px-3 py-2" style={{ backgroundColor: "#F7E4E1", color: "#96362B" }}>
            {saveError}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20" style={{ color: "#8A8375" }}>
            <Loader2 className="animate-spin mr-2" size={18} /> Đang tải dữ liệu...
          </div>
        ) : (
          <>
            {view === "dashboard" && (
              <DashboardView records={records} overdueDays={overdueDays} setOverdueDays={setOverdueDays} />
            )}
            {view === "scan" && (
              <ScanView
                records={records}
                overdueDays={overdueDays}
                onResolveScan={resolveScan}
                onQuickAdd={(code) => { setPrefillCode(code); setShowAdd(true); }}
              />
            )}
            {view === "import" && (
              <ImportView
                records={records}
                onImport={importRecords}
                fileHistory={fileHistory}
                onRecordFileHistory={recordFileHistory}
                onDownloadFile={downloadFile}
              />
            )}
            {view === "list" && <ListView records={records} overdueDays={overdueDays} onComplete={markComplete} />}
          </>
        )}
      </div>

      {showAdd && (
        <AddModal
          prefillOrderCode={prefillCode}
          onClose={() => { setShowAdd(false); setPrefillCode(""); }}
          onSave={addRecord}
        />
      )}
    </div>
  );
}
