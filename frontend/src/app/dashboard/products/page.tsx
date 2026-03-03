"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useOrg } from "@/lib/org-context";
import { INDUSTRY_TEMPLATES } from "@/lib/industry-templates";
import type { IndustryField } from "@/lib/industry-templates";
import {
    Plus, Package, Search, X, Trash2, Upload, FileText,
    Image as ImageIcon, Loader2, GripVertical, LayoutGrid,
} from "lucide-react";

/* ── Types ────────────────────────────────────────── */
interface CatalogItem {
    id: string;
    name: string;
    description: string;
    attributes: Record<string, string>;
    status: string;
    embedding: number[] | null;
    created_at: string;
    product_files?: PFile[];
}
interface PFile {
    id: string;
    file_url: string;
    file_name: string;
    file_type: string;
    file_size: number;
}
interface AttrRow { key: string; value: string }

/* ── Helpers ──────────────────────────────────────── */
const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" });
const fmtSize = (b: number) =>
    b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB";

/* ── Page Component ───────────────────────────────── */
export default function CatalogPage() {
    const { organization } = useOrg();
    const [items, setItems] = useState<CatalogItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    /* Detect industry from org settings */
    const industryId = (organization as any)?.settings?.industry_template ?? "real_estate";
    const template = INDUSTRY_TEMPLATES.find(t => t.id === industryId) ?? INDUSTRY_TEMPLATES[1];
    const itemLabel = template.catalogLabel;
    const industryFields: IndustryField[] = template.industryFields;

    /* Modal state */
    const [showModal, setShowModal] = useState(false);
    const [editItem, setEditItem] = useState<CatalogItem | null>(null);
    const [viewItem, setViewItem] = useState<CatalogItem | null>(null);

    /* Form state */
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [price, setPrice] = useState(""); // stored in attributes.precio
    const [quickFields, setQuickFields] = useState<Record<string, string>>({});
    const [attrs, setAttrs] = useState<AttrRow[]>([]);         // extra free-form
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [existingFiles, setExistingFiles] = useState<PFile[]>([]);
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    /* ── Fetch items ────────────────────────────────── */
    const fetchItems = useCallback(async () => {
        if (!organization) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/products?organization_id=${organization.id}`);
            const data = await res.json();
            setItems(data.products || []);
        } catch { /* empty */ }
        setLoading(false);
    }, [organization]);

    useEffect(() => { fetchItems(); }, [fetchItems]);

    /* ── Open modal ────────────────────────────────── */
    const initQuickFields = (existing: Record<string, string> = {}) => {
        const qf: Record<string, string> = {};
        industryFields.forEach(f => { qf[f.key] = existing[f.key] ?? ""; });
        setQuickFields(qf);
    };

    const openCreate = () => {
        setEditItem(null); setName(""); setDescription(""); setPrice("");
        initQuickFields();
        setAttrs([]); setPendingFiles([]); setExistingFiles([]);
        setFormError(""); setShowModal(true);
    };

    const openEdit = (p: CatalogItem) => {
        setEditItem(p); setName(p.name); setDescription(p.description);
        setPrice(p.attributes?.precio ?? "");
        initQuickFields(p.attributes ?? {});
        // Free-form attrs = all keys not in industryFields and not "precio"
        const reservedKeys = new Set([...industryFields.map(f => f.key), "precio"]);
        setAttrs(Object.entries(p.attributes || {})
            .filter(([k]) => !reservedKeys.has(k))
            .map(([key, value]) => ({ key, value })));
        setExistingFiles(p.product_files || []); setPendingFiles([]);
        setFormError(""); setShowModal(true);
    };

    /* ── Save item ──────────────────────────────────── */
    const handleSave = async () => {
        if (!name.trim()) { setFormError("El nombre es obligatorio"); return; }
        setSaving(true); setFormError("");

        // Merge: price + quick fields + free-form attrs
        const attributes: Record<string, string> = {};
        if (price.trim()) attributes["precio"] = price.trim();
        Object.entries(quickFields).forEach(([k, v]) => { if (v.trim()) attributes[k] = v.trim(); });
        attrs.forEach(a => { if (a.key.trim()) attributes[a.key.trim()] = a.value; });

        try {
            const method = editItem ? "PUT" : "POST";
            const url = editItem ? `/api/products/${editItem.id}` : "/api/products";
            const body: any = { name, description, attributes, organization_id: organization.id };

            const res = await fetch(url, {
                method, headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || "Error al guardar");
            }
            const { product } = await res.json();

            for (const file of pendingFiles) {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("product_id", product.id);
                await fetch("/api/files", { method: "POST", body: fd });
            }

            setShowModal(false);
            fetchItems();
        } catch (err: any) {
            setFormError(err.message);
        }
        setSaving(false);
    };

    /* ── Delete item ────────────────────────────────── */
    const handleDelete = async (id: string) => {
        if (!confirm(`¿Eliminar este ${itemLabel.toLowerCase()}?`)) return;
        await fetch(`/api/products/${id}`, { method: "DELETE" });
        fetchItems();
    };

    /* ── Delete file ────────────────────────────────── */
    const handleDeleteFile = async (fileId: string) => {
        await fetch(`/api/files?id=${fileId}`, { method: "DELETE" });
        setExistingFiles(f => f.filter(x => x.id !== fileId));
    };

    /* ── Drag & Drop ────────────────────────────────── */
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter(
            f => f.type.startsWith("image/") || f.type === "application/pdf"
        );
        setPendingFiles(prev => [...prev, ...files]);
    };

    const filtered = items.filter(
        p => p.name.toLowerCase().includes(search.toLowerCase()) ||
            p.description.toLowerCase().includes(search.toLowerCase())
    );

    /* ── Render ─────────────────────────────────────── */
    return (
        <div className="animate-in">
            {/* ── Header ───────────────────────────── */}
            <div className="page-header">
                <div>
                    <h1 className="page-title">Inventario</h1>
                    <p className="page-subtitle">
                        {items.length} {itemLabel.toLowerCase()}{items.length !== 1 ? "s" : ""} registrado{items.length !== 1 ? "s" : ""} · El bot usa este catálogo en cada conversación
                    </p>
                </div>
                <button onClick={openCreate} className="btn-primary">
                    <Plus size={18} /> Nuevo {itemLabel}
                </button>
            </div>

            {/* ── Search ───────────────────────────── */}
            {items.length > 0 && (
                <div className="relative mb-6 max-w-md">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2"
                        style={{ color: "var(--text-muted)" }} />
                    <input className="input pl-11" placeholder={`Buscar ${itemLabel.toLowerCase()}s…`}
                        value={search} onChange={e => setSearch(e.target.value)} />
                </div>
            )}

            {/* ── Loading ──────────────────────────── */}
            {loading && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                </div>
            )}

            {/* ── Empty state ──────────────────────── */}
            {!loading && items.length === 0 && (
                <div className="glass-card p-0 overflow-hidden">
                    <div className="flex flex-col items-center justify-center py-20 px-8">
                        <div className="flex items-center justify-center w-20 h-20 rounded-3xl mb-6"
                            style={{ background: "rgba(124,58,237,0.08)", border: "1px dashed var(--border-active)" }}>
                            <LayoutGrid size={36} style={{ color: "var(--accent-light)", opacity: 0.6 }} />
                        </div>
                        <h3 className="text-lg font-bold mb-2" style={{ color: "var(--text-primary)" }}>
                            Sin {itemLabel.toLowerCase()}s todavía
                        </h3>
                        <p className="text-sm mb-6 text-center max-w-sm" style={{ color: "var(--text-secondary)" }}>
                            Registra tu primer {itemLabel.toLowerCase()} para que el agente AI pueda responder consultas
                            con información precisa de tu catálogo.
                        </p>
                        <button onClick={openCreate} className="btn-primary">
                            <Plus size={18} /> Crear Primer {itemLabel}
                        </button>
                    </div>
                </div>
            )}

            {/* ── Grid ─────────────────────────────── */}
            {!loading && filtered.length > 0 && (
                <div className="grid-products">
                    {filtered.map(p => {
                        const imgFile = p.product_files?.find(f => f.file_type === "image");
                        const hasEmbedding = !!p.embedding;
                        return (
                            <div key={p.id} className="glass-card overflow-hidden group cursor-pointer"
                                onClick={() => setViewItem(p)}>
                                {/* Image */}
                                <div className="h-40 flex items-center justify-center relative overflow-hidden"
                                    style={{ background: "var(--bg-secondary)" }}>
                                    {imgFile ? (
                                        <img src={imgFile.file_url} alt={p.name} className="w-full h-full object-cover" />
                                    ) : (
                                        <Package size={40} style={{ color: "var(--text-muted)", opacity: 0.3 }} />
                                    )}
                                    <div className="absolute top-3 right-3">
                                        <span className={`badge ${hasEmbedding ? "badge-active" : "badge-inactive"}`}
                                            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                            {hasEmbedding ? "Vectorizado ✅" : "Pendiente ⏳"}
                                        </span>
                                    </div>
                                </div>
                                {/* Content */}
                                <div className="p-5">
                                    <h3 className="font-semibold text-sm mb-1 truncate"
                                        style={{ color: "var(--text-primary)" }}>{p.name}</h3>
                                    {p.attributes?.precio && (
                                        <p className="text-base font-bold mb-1" style={{ color: "var(--accent-light)" }}>
                                            ${Number(p.attributes.precio).toLocaleString("es-CL")}
                                        </p>
                                    )}
                                    <p className="text-xs line-clamp-2 mb-3" style={{ color: "var(--text-secondary)" }}>
                                        {p.description || "Sin descripción"}
                                    </p>
                                    {/* Quick field badges */}
                                    {Object.keys(p.attributes || {}).length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-3">
                                            {Object.entries(p.attributes).filter(([k]) => k !== "precio").slice(0, 3).map(([k, v]) => (
                                                <span key={k} className="text-[0.65rem] px-2 py-0.5 rounded-full"
                                                    style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-secondary)", border: "1px solid rgba(255,255,255,0.07)" }}>
                                                    {k}: {v}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {/* Footer */}
                                    <div className="flex items-center justify-between pt-3"
                                        style={{ borderTop: "1px solid var(--border)" }}>
                                        <span className="text-[0.65rem]" style={{ color: "var(--text-muted)" }}>
                                            {fmtDate(p.created_at)}
                                        </span>
                                        <div className="flex gap-1">
                                            <button onClick={e => { e.stopPropagation(); openEdit(p); }}
                                                className="btn-secondary" style={{ padding: "6px 12px", fontSize: "0.7rem" }}>
                                                Editar
                                            </button>
                                            <button onClick={e => { e.stopPropagation(); handleDelete(p.id); }}
                                                className="btn-danger" style={{ padding: "6px 10px" }}>
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── VIEW Modal ───────────────────────── */}
            {viewItem && (
                <div className="modal-overlay animate-in" onClick={() => setViewItem(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "560px" }}>
                        <div className="modal-header">
                            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{viewItem.name}</h2>
                            <button onClick={() => setViewItem(null)}
                                className="p-1 rounded-lg transition-colors hover:bg-white/5 cursor-pointer"
                                style={{ background: "none", border: "none", color: "var(--text-muted)" }}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body space-y-4">
                            {viewItem.description && (
                                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{viewItem.description}</p>
                            )}
                            {Object.keys(viewItem.attributes || {}).length > 0 && (
                                <div>
                                    <h4 className="form-label mb-2">Atributos</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.entries(viewItem.attributes).map(([k, v]) => (
                                            <div key={k} className="flex items-center gap-2 p-2.5 rounded-lg"
                                                style={{ background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                                                <span className="text-xs font-medium" style={{ color: "var(--accent-light)" }}>{k}</span>
                                                <span className="text-xs" style={{ color: "var(--text-primary)" }}>{v}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {viewItem.product_files && viewItem.product_files.length > 0 && (
                                <div>
                                    <h4 className="form-label mb-2">Archivos</h4>
                                    <div className="grid grid-cols-2 gap-2">
                                        {viewItem.product_files.map(f => (
                                            <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"
                                                className="flex items-center gap-2 p-3 rounded-lg transition-colors hover:bg-white/5"
                                                style={{ background: "var(--bg-card)", border: "1px solid var(--border)", textDecoration: "none" }}>
                                                {f.file_type === "image" ?
                                                    <ImageIcon size={16} style={{ color: "var(--info)" }} /> :
                                                    <FileText size={16} style={{ color: "var(--warning)" }} />}
                                                <span className="text-xs truncate" style={{ color: "var(--text-primary)" }}>{f.file_name}</span>
                                            </a>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── CREATE / EDIT Modal ──────────────── */}
            {showModal && (
                <div className="modal-overlay animate-in" onClick={() => setShowModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: "640px" }}>
                        <div className="modal-header mb-2">
                            <h2 className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>
                                {editItem ? `Editar ${itemLabel}` : `Nuevo ${itemLabel}`}
                            </h2>
                            <button onClick={() => setShowModal(false)}
                                className="p-1 rounded-lg transition-colors hover:bg-white/5 cursor-pointer"
                                style={{ background: "none", border: "none", color: "var(--text-muted)" }}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="modal-body space-y-5">
                            {formError && (
                                <div className="p-3 rounded-lg text-sm"
                                    style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>
                                    {formError}
                                </div>
                            )}

                            {/* Name */}
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Nombre *</label>
                                <input className="input" placeholder={`Ej: ${itemLabel} destacado`}
                                    value={name} onChange={e => setName(e.target.value)} autoFocus />
                            </div>

                            {/* Price */}
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Precio</label>
                                <input className="input" placeholder="Ej: 150000" type="number" min="0"
                                    value={price} onChange={e => setPrice(e.target.value)} />
                            </div>

                            {/* Description */}
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Descripción</label>
                                <textarea className="textarea" placeholder={`Describe este ${itemLabel.toLowerCase()} en detalle…`}
                                    value={description} onChange={e => setDescription(e.target.value)}
                                    rows={3} style={{ minHeight: "80px" }} />
                            </div>

                            {/* ── Industry Quick Fields ───────────── */}
                            {industryFields.length > 0 && (
                                <div>
                                    <label className="form-label mb-3 block">
                                        Campos de {template.label}
                                    </label>
                                    <div style={{ display: "grid", gridTemplateColumns: industryFields.length > 1 ? "1fr 1fr" : "1fr", gap: "12px" }}>
                                        {industryFields.map(field => (
                                            <div key={field.key} className="form-group" style={{ marginBottom: 0 }}>
                                                <label className="form-label">{field.label}</label>
                                                {field.type === "select" ? (
                                                    <select className="select"
                                                        value={quickFields[field.key] ?? ""}
                                                        onChange={e => setQuickFields(prev => ({ ...prev, [field.key]: e.target.value }))}>
                                                        <option value="">— Seleccionar —</option>
                                                        {field.options?.map(opt => (
                                                            <option key={opt} value={opt}>{opt}</option>
                                                        ))}
                                                    </select>
                                                ) : (
                                                    <input
                                                        className="input"
                                                        type={field.type}
                                                        placeholder={field.placeholder}
                                                        value={quickFields[field.key] ?? ""}
                                                        onChange={e => setQuickFields(prev => ({ ...prev, [field.key]: e.target.value }))}
                                                    />
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* ── Extra Free-Form Attributes ──────── */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="form-label" style={{ marginBottom: 0 }}>
                                        Atributos Extra
                                    </label>
                                    <button type="button" onClick={() => setAttrs([...attrs, { key: "", value: "" }])}
                                        className="btn-secondary" style={{ padding: "4px 10px", fontSize: "0.7rem" }}>
                                        <Plus size={14} /> Agregar
                                    </button>
                                </div>
                                {attrs.length === 0 && (
                                    <p className="text-xs py-3 text-center rounded-lg"
                                        style={{ color: "var(--text-muted)", background: "var(--bg-card)", border: "1px dashed var(--border)" }}>
                                        Sin atributos extra — agrega campos personalizados opcionales
                                    </p>
                                )}
                                <div className="space-y-2.5">
                                    {attrs.map((a, i) => (
                                        <div key={i} className="flex items-center gap-2">
                                            <GripVertical size={14} style={{ color: "var(--text-muted)", opacity: 0.4, flexShrink: 0 }} />
                                            <input className="input" placeholder="Clave"
                                                value={a.key} style={{ flex: 1 }}
                                                onChange={e => {
                                                    const next = [...attrs]; next[i].key = e.target.value; setAttrs(next);
                                                }} />
                                            <input className="input" placeholder="Valor"
                                                value={a.value} style={{ flex: 1 }}
                                                onChange={e => {
                                                    const next = [...attrs]; next[i].value = e.target.value; setAttrs(next);
                                                }} />
                                            <button onClick={() => setAttrs(attrs.filter((_, idx) => idx !== i))}
                                                className="p-1.5 rounded-lg transition-colors hover:bg-white/5 shrink-0 cursor-pointer"
                                                style={{ background: "none", border: "none", color: "var(--danger)" }}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* ── File Upload ──────────────────── */}
                            <div>
                                <label className="form-label">Archivos</label>
                                <div className="flex flex-col items-center justify-center p-6 rounded-xl transition-colors cursor-pointer"
                                    style={{ border: "2px dashed var(--border)", background: "var(--bg-card)" }}
                                    onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--accent)"; }}
                                    onDragLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; }}
                                    onDrop={e => { e.currentTarget.style.borderColor = "var(--border)"; handleDrop(e); }}
                                    onClick={() => fileInputRef.current?.click()}>
                                    <Upload size={24} className="mb-2" style={{ color: "var(--text-muted)" }} />
                                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                        Arrastra imágenes o PDFs, o <span style={{ color: "var(--accent-light)", fontWeight: 600 }}>haz clic</span>
                                    </p>
                                    <input ref={fileInputRef} type="file" className="hidden"
                                        accept="image/*,.pdf" multiple
                                        onChange={e => { if (e.target.files) setPendingFiles(prev => [...prev, ...Array.from(e.target.files!)]); }} />
                                </div>

                                {existingFiles.length > 0 && (
                                    <div className="mt-3 space-y-1.5">
                                        <span className="text-[0.65rem] font-semibold uppercase tracking-wider"
                                            style={{ color: "var(--text-muted)" }}>Archivos existentes</span>
                                        {existingFiles.map(f => (
                                            <div key={f.id} className="flex items-center gap-2 p-2 rounded-lg"
                                                style={{ background: "var(--bg-secondary)", border: "1px solid var(--border)" }}>
                                                {f.file_type === "image" ?
                                                    <ImageIcon size={14} style={{ color: "var(--info)" }} /> :
                                                    <FileText size={14} style={{ color: "var(--warning)" }} />}
                                                <span className="text-xs flex-1 truncate" style={{ color: "var(--text-primary)" }}>{f.file_name}</span>
                                                <span className="text-[0.6rem]" style={{ color: "var(--text-muted)" }}>{fmtSize(f.file_size)}</span>
                                                <button onClick={() => handleDeleteFile(f.id)}
                                                    className="p-1 rounded hover:bg-white/5 cursor-pointer"
                                                    style={{ background: "none", border: "none", color: "var(--danger)" }}>
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {pendingFiles.length > 0 && (
                                    <div className="mt-3 space-y-1.5">
                                        <span className="text-[0.65rem] font-semibold uppercase tracking-wider"
                                            style={{ color: "var(--text-muted)" }}>Por subir</span>
                                        {pendingFiles.map((f, i) => (
                                            <div key={i} className="flex items-center gap-2 p-2 rounded-lg"
                                                style={{ background: "var(--bg-secondary)", border: "1px solid rgba(255,255,255,0.06)" }}>
                                                {f.type.startsWith("image/") ?
                                                    <ImageIcon size={14} style={{ color: "var(--info)" }} /> :
                                                    <FileText size={14} style={{ color: "var(--warning)" }} />}
                                                <span className="text-xs flex-1 truncate" style={{ color: "var(--text-primary)" }}>{f.name}</span>
                                                <span className="text-[0.6rem]" style={{ color: "var(--text-muted)" }}>{fmtSize(f.size)}</span>
                                                <button onClick={() => setPendingFiles(pendingFiles.filter((_, idx) => idx !== i))}
                                                    className="p-1 rounded hover:bg-white/5 cursor-pointer"
                                                    style={{ background: "none", border: "none", color: "var(--danger)" }}>
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="modal-footer">
                            <button onClick={() => setShowModal(false)} className="btn-secondary">Cancelar</button>
                            <button onClick={handleSave} className="btn-primary" disabled={saving}>
                                {saving ? <><Loader2 size={15} className="animate-spin" /> Guardando…</> : <>{editItem ? "Actualizar" : `Crear ${itemLabel}`}</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
