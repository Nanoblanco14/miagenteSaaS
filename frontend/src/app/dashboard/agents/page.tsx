"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useOrg } from "@/lib/org-context";
import { INDUSTRY_TEMPLATES } from "@/lib/industry-templates";
import { applyIndustryTemplate } from "../settings/actions";
import { scrapeUrlsForPreview, saveScrapedContext } from "./actions";
import type { ConversationTone } from "@/lib/types";
import {
    Bot, Save, Sparkles, CheckCircle, CalendarCheck,
    MessageSquare, SlidersHorizontal, AlertTriangle, Kanban, Loader2, Check,
    Scissors, Building2, ShoppingBag, FileText, Briefcase, Rocket, Smile,
    Globe, RefreshCw, BookOpen, Plus, Trash2, Database,
} from "lucide-react";

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
    hair_salon: <Scissors size={17} />,
    real_estate: <Building2 size={17} />,
    ecommerce: <ShoppingBag size={17} />,
    blank: <FileText size={17} />,
};

const TONE_ICONS: Record<string, React.ReactNode> = {
    "Profesional y Formal": <Briefcase size={15} />,
    "Amigable y Casual": <Smile size={15} />,
    "Entusiasta y Vendedor": <Rocket size={15} />,
};

const TONE_OPTIONS: { value: ConversationTone; label: string; desc: string }[] = [
    { value: "Profesional y Formal", label: "Profesional y Formal", desc: "Preciso, vocabulario corporativo" },
    { value: "Amigable y Casual", label: "Amigable y Casual", desc: "Cercano, coloquial, como un amigo experto" },
    { value: "Entusiasta y Vendedor", label: "Entusiasta y Vendedor", desc: "Proactivo, persuasivo, orientado a cerrar" },
];

interface AgentData {
    id: string; name: string; system_prompt: string; welcome_message: string;
    model: string; temperature: number; booking_url: string | null;
    conversation_tone: ConversationTone | null; escalation_rule: string | null;
    is_active: boolean; scraped_context?: string | null;
}

/* ── Unified icon container — zinc-800/50, white icon ─ */
function IconBox({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: "34px", height: "34px", borderRadius: "10px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.07)",
            color: "#a1a1aa", flexShrink: 0,
        }}>
            {children}
        </div>
    );
}

function SectionCard({ icon, title, subtitle, children }: {
    icon: React.ReactNode; title: string; subtitle: string; children: React.ReactNode;
}) {
    return (
        <div className="glass-card" style={{ cursor: "default" }}>
            <div className="p-6">
                <div className="flex items-center gap-3 mb-5">
                    <IconBox>{icon}</IconBox>
                    <div>
                        <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h3>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{subtitle}</p>
                    </div>
                </div>
                {children}
            </div>
        </div>
    );
}

export default function AgentConfigPage() {
    const { organization } = useOrg();
    const [agent, setAgent] = useState<AgentData | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [name, setName] = useState("");
    const [systemPrompt, setSystemPrompt] = useState("");
    const [welcomeMessage, setWelcomeMessage] = useState("");
    const [model, setModel] = useState("gpt-4o-mini");
    const [temperature, setTemperature] = useState(0.7);
    const [bookingUrl, setBookingUrl] = useState("");
    const [tone, setTone] = useState<ConversationTone>("Profesional y Formal");
    const [escalationRule, setEscalationRule] = useState("");
    const [selectedTplId, setSelectedTplId] = useState<string | null>(null);
    const [applyingTpl, setApplyingTpl] = useState(false);
    const [tplResult, setTplResult] = useState<{ stagesCreated: boolean; msg: string } | null>(null);

    // ── URL Brain state ───────────────────────────────────────
    const [urls, setUrls] = useState<string[]>([""]);  // multi-URL list
    const [scraping, setScraping] = useState(false);
    const [scrapeErrors, setScrapeErrors] = useState<string[]>([]);
    const [extractedText, setExtractedText] = useState<string | null>(null); // review buffer
    const [contextSaving, setContextSaving] = useState(false);
    const [contextSaved, setContextSaved] = useState(false);
    const [currentContext, setCurrentContext] = useState<string | null>(null);

    const loadAgent = useCallback(async () => {
        try {
            const res = await fetch(`/api/agents?org_id=${organization.id}`);
            const { data } = await res.json();
            if (data && data.length > 0) {
                const a: AgentData = data[0];
                setAgent(a); setName(a.name);
                setSystemPrompt(a.system_prompt || "");
                setWelcomeMessage(a.welcome_message || "¡Hola! ¿En qué puedo ayudarte?");
                setModel(a.model || "gpt-4o-mini");
                setTemperature(a.temperature ?? 0.7);
                setBookingUrl(a.booking_url || "");
                setTone((a.conversation_tone as ConversationTone) || "Profesional y Formal");
                setEscalationRule(a.escalation_rule || "");
                setCurrentContext(a.scraped_context || null);
            } else {
                const createRes = await fetch("/api/agents", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ organization_id: organization.id, name: "Asistente Virtual", system_prompt: "", welcome_message: "¡Hola! ¿En qué puedo ayudarte hoy?" }),
                });
                const { data: newAgent } = await createRes.json();
                if (newAgent) {
                    setAgent(newAgent); setName(newAgent.name || "Asistente Virtual");
                    setSystemPrompt(newAgent.system_prompt || "");
                    setWelcomeMessage(newAgent.welcome_message || "");
                    setModel(newAgent.model || "gpt-4o-mini");
                    setTemperature(newAgent.temperature ?? 0.7);
                }
            }
        } catch (err) { console.error("Failed to load agent:", err); }
        setLoading(false);
    }, [organization.id]);

    useEffect(() => { loadAgent(); }, [loadAgent]);

    const handleApplyTemplate = async () => {
        if (!selectedTplId) return;
        setApplyingTpl(true); setTplResult(null);
        const tpl = INDUSTRY_TEMPLATES.find((t) => t.id === selectedTplId);
        if (tpl?.systemPrompt) setSystemPrompt(tpl.systemPrompt);
        if (tpl?.defaultName) setName(tpl.defaultName);
        if (tpl?.defaultWelcome) setWelcomeMessage(tpl.defaultWelcome);
        const result = await applyIndustryTemplate(organization.id, selectedTplId);
        setTplResult({
            stagesCreated: result.stagesCreated ?? false,
            msg: result.stagesCreated
                ? "Pipeline creado con las columnas de tu industria."
                : "Prompt actualizado. Tu pipeline existente no fue modificado.",
        });
        setApplyingTpl(false);
    };

    const handleSave = async () => {
        if (!agent) return;
        setSaving(true); setSaved(false);
        try {
            await fetch(`/api/agents/${agent.id}`, {
                method: "PUT", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, system_prompt: systemPrompt, welcome_message: welcomeMessage, model, temperature, booking_url: bookingUrl || null, conversation_tone: tone, escalation_rule: escalationRule || null }),
            });
            setSaved(true); setTimeout(() => setSaved(false), 2500);
        } catch (err) { console.error("Failed to save agent:", err); }
        setSaving(false);
    };

    // ── URL Brain handlers ────────────────────────────────────
    const addUrl = () => setUrls((prev) => [...prev, ""]);
    const removeUrl = (i: number) => setUrls((prev) => prev.filter((_, idx) => idx !== i));
    const updateUrl = (i: number, val: string) =>
        setUrls((prev) => prev.map((u, idx) => (idx === i ? val : u)));

    const handleScrape = async () => {
        if (!agent) return;
        setScraping(true); setScrapeErrors([]); setExtractedText(null); setContextSaved(false);
        const result = await scrapeUrlsForPreview(urls);
        if (result.ok && result.text) {
            setExtractedText(result.text);
        }
        if (result.errors?.length) {
            setScrapeErrors(result.errors);
        }
        if (!result.ok && !result.text) {
            setScrapeErrors(result.errors ?? ["Error desconocido al extraer contenido."]);
        }
        setScraping(false);
    };

    const handleSaveContext = async () => {
        if (!agent || !extractedText?.trim()) return;
        setContextSaving(true); setContextSaved(false);
        const result = await saveScrapedContext(agent.id, extractedText);
        if (result.ok) {
            setCurrentContext(extractedText);
            setContextSaved(true);
            setTimeout(() => setContextSaved(false), 3000);
        } else {
            setScrapeErrors([result.error ?? "Error al guardar."]);
        }
        setContextSaving(false);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-32">
                <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
        );
    }

    return (
        <div className="animate-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Mi Asistente</h1>
                    <p className="page-subtitle">Define la personalidad, el tono y el comportamiento de tu bot</p>
                </div>
                <button onClick={handleSave} className="btn-primary" disabled={saving} style={{ minWidth: "160px" }}>
                    {saving ? <><Loader2 size={14} className="animate-spin" /> Guardando…</>
                        : saved ? <><CheckCircle size={14} /> ¡Guardado!</>
                            : <><Save size={14} /> Guardar Cambios</>}
                </button>
            </div>

            <div style={{ display: "grid", gap: "20px" }}>

                {/* ── Plantillas ── */}
                <SectionCard icon={<Sparkles size={17} />} title="Plantillas por Industria" subtitle="Selecciona tu industria para auto-rellenar el prompt">
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px", marginBottom: "14px" }}>
                        {INDUSTRY_TEMPLATES.map((tpl) => {
                            const isSelected = selectedTplId === tpl.id;
                            return (
                                <button key={tpl.id} onClick={() => {
                                    setSelectedTplId(tpl.id);
                                    setTplResult(null);
                                    if (tpl.systemPrompt) setSystemPrompt(tpl.systemPrompt);
                                    if (tpl.defaultName) setName(tpl.defaultName);
                                    if (tpl.defaultWelcome) setWelcomeMessage(tpl.defaultWelcome);
                                }}
                                    style={{
                                        padding: "13px 10px", borderRadius: "10px",
                                        border: isSelected ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.06)",
                                        background: isSelected ? "rgba(59,130,246,0.07)" : "rgba(255,255,255,0.02)",
                                        cursor: "pointer", textAlign: "left" as const,
                                        transition: "all 0.15s ease",
                                        boxShadow: isSelected ? "0 0 0 1px rgba(59,130,246,0.15)" : "none",
                                    }}>
                                    <div style={{ marginBottom: "7px", color: isSelected ? "#60a5fa" : "#52525b" }}>
                                        {TEMPLATE_ICONS[tpl.id] ?? <FileText size={17} />}
                                    </div>
                                    <div style={{ fontSize: "0.77rem", fontWeight: 600, color: isSelected ? "#f4f4f5" : "#a1a1aa" }}>{tpl.label}</div>
                                    <div style={{ fontSize: "0.67rem", color: "#52525b", marginTop: "2px" }}>{tpl.description}</div>
                                </button>
                            );
                        })}
                    </div>

                    {selectedTplId && selectedTplId !== "blank" && (() => {
                        const tpl = INDUSTRY_TEMPLATES.find((t) => t.id === selectedTplId);
                        if (!tpl) return null;
                        return (
                            <div style={{ padding: "10px 14px", borderRadius: "10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", marginBottom: "12px" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "8px" }}>
                                    <Kanban size={12} style={{ color: "var(--text-muted)" }} />
                                    <span style={{ fontSize: "0.65rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Pipeline</span>
                                </div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                                    {tpl.stages.map((s) => (
                                        <span key={s.name} style={{ padding: "2px 9px", borderRadius: "100px", fontSize: "0.7rem", fontWeight: 500, background: `${s.color}14`, color: s.color, border: `1px solid ${s.color}30` }}>
                                            {s.name}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        );
                    })()}

                    {tplResult && (
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", borderRadius: "10px", marginBottom: "12px", fontSize: "0.8rem", fontWeight: 500, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "var(--text-secondary)" }}>
                            <Check size={13} style={{ color: "var(--success)" }} />{tplResult.msg}
                        </div>
                    )}

                    <button className="btn-primary" onClick={handleApplyTemplate} disabled={!selectedTplId || applyingTpl} style={{ width: "100%", justifyContent: "center" }}>
                        {applyingTpl ? <><Loader2 size={13} className="animate-spin" /> Aplicando…</> : <><Sparkles size={13} /> Aplicar Plantilla</>}
                    </button>
                    <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>El prompt se actualiza al seleccionar. Haz clic en "Aplicar" para crear las columnas del pipeline.</p>
                </SectionCard>

                {/* ── 2-col grid ── */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>

                    <SectionCard icon={<Bot size={17} />} title="Identidad del Agente" subtitle="Nombre, prompt base y mensaje de bienvenida">
                        <div className="space-y-4">
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Nombre del Agente</label>
                                <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Vendedor Estrella" />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Prompt del Sistema</label>
                                <textarea className="textarea" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                                    placeholder="Selecciona una plantilla o escribe aquí las instrucciones…"
                                    style={{ minHeight: "200px", fontFamily: "monospace", fontSize: "0.78rem", lineHeight: 1.7 }} />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label"><MessageSquare size={11} className="inline mr-1" />Mensaje de Bienvenida</label>
                                <input className="input" value={welcomeMessage} onChange={e => setWelcomeMessage(e.target.value)} placeholder="¡Hola! ¿En qué puedo ayudarte?" />
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard icon={<SlidersHorizontal size={17} />} title="Comportamiento Avanzado" subtitle="Tono de conversación y reglas de derivación">
                        <div className="space-y-4">
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Tono de Conversación</label>
                                <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                                    {TONE_OPTIONS.map((opt) => {
                                        const isSelected = tone === opt.value;
                                        return (
                                            <button key={opt.value} type="button" onClick={() => setTone(opt.value)} style={{
                                                display: "flex", alignItems: "center", gap: "11px", padding: "11px 13px", borderRadius: "10px",
                                                border: isSelected ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.06)",
                                                background: isSelected ? "rgba(59,130,246,0.07)" : "rgba(255,255,255,0.02)",
                                                cursor: "pointer", textAlign: "left", transition: "all 0.15s ease", width: "100%",
                                            }}>
                                                <span style={{ color: isSelected ? "#60a5fa" : "#52525b", flexShrink: 0 }}>
                                                    {TONE_ICONS[opt.value]}
                                                </span>
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: "0.82rem", fontWeight: 600, color: isSelected ? "#f4f4f5" : "#a1a1aa" }}>{opt.label}</div>
                                                    <div style={{ fontSize: "0.7rem", color: "#52525b" }}>{opt.desc}</div>
                                                </div>
                                                {isSelected && <Check size={13} style={{ color: "#60a5fa", flexShrink: 0 }} />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label"><AlertTriangle size={11} className="inline mr-1" />Regla de Derivación</label>
                                <textarea className="textarea" rows={3} value={escalationRule} onChange={e => setEscalationRule(e.target.value)}
                                    placeholder="Ej: Derivar a un humano si el cliente pide un reembolso." style={{ resize: "vertical", minHeight: "80px" }} />
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard icon={<SlidersHorizontal size={17} />} title="Modelo y Parámetros" subtitle="Modelo GPT y creatividad">
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Modelo</label>
                                <select className="select" value={model} onChange={e => setModel(e.target.value)}>
                                    <option value="gpt-4o-mini">GPT-4o Mini</option>
                                    <option value="gpt-4o">GPT-4o</option>
                                    <option value="gpt-4-turbo">GPT-4 Turbo</option>
                                </select>
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label className="form-label">Temperatura: {temperature}</label>
                                <input type="range" min="0" max="1" step="0.1" value={temperature} onChange={e => setTemperature(parseFloat(e.target.value))} style={{ width: "100%", marginTop: "8px" }} />
                                <div className="flex justify-between mt-1" style={{ color: "var(--text-muted)", fontSize: "0.6rem" }}>
                                    <span>Preciso</span><span>Creativo</span>
                                </div>
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard icon={<CalendarCheck size={17} />} title="Link de Agenda" subtitle="URL para citas — Cal.com / Calendly">
                        <div className="form-group" style={{ marginBottom: 0 }}>
                            <label className="form-label">URL de Agendamiento</label>
                            <input className="input" value={bookingUrl} onChange={e => setBookingUrl(e.target.value)} placeholder="Pega aquí tu link de agendamiento" />
                            <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>El agente compartirá este link cuando un cliente quiera agendar.</p>
                        </div>
                    </SectionCard>

                </div>

                {/* ── URL Brain — full width ── */}
                <SectionCard
                    icon={<BookOpen size={17} />}
                    title="Entrenar con URL (Base de Conocimiento)"
                    subtitle="Extrae contenido de una o varias páginas de tu web y revísalo antes de guardar"
                >
                    <div className="space-y-4">

                        {/* ── URL list ── */}
                        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                            {urls.map((url, i) => (
                                <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                    <div style={{ position: "relative", flex: 1 }}>
                                        <Globe size={14} style={{
                                            position: "absolute", left: "12px", top: "50%",
                                            transform: "translateY(-50%)", color: "var(--text-muted)",
                                            pointerEvents: "none",
                                        }} />
                                        <input
                                            className="input"
                                            style={{ paddingLeft: "36px" }}
                                            value={url}
                                            onChange={(e) => updateUrl(i, e.target.value)}
                                            onKeyDown={(e) => e.key === "Enter" && i === urls.length - 1 && addUrl()}
                                            placeholder={i === 0 ? "https://tuempresa.com/inicio" : "https://tuempresa.com/faq"}
                                            disabled={scraping}
                                        />
                                    </div>
                                    {urls.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeUrl(i)}
                                            disabled={scraping}
                                            title="Eliminar esta URL"
                                            style={{
                                                background: "rgba(239,68,68,0.08)",
                                                border: "1px solid rgba(239,68,68,0.2)",
                                                borderRadius: "8px", color: "#f87171",
                                                padding: "8px", cursor: "pointer",
                                                display: "flex", alignItems: "center",
                                                transition: "all 0.15s ease", flexShrink: 0,
                                            }}
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* ── Add URL + Extract buttons ── */}
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                            <button
                                type="button"
                                onClick={addUrl}
                                disabled={scraping}
                                style={{
                                    display: "flex", alignItems: "center", gap: "6px",
                                    padding: "9px 14px", borderRadius: "9px", fontSize: "0.8rem",
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    color: "var(--text-secondary)", cursor: "pointer",
                                    transition: "all 0.15s ease",
                                }}
                            >
                                <Plus size={14} /> Agregar otra URL
                            </button>

                            <button
                                className="btn-primary"
                                onClick={handleScrape}
                                disabled={scraping || urls.every((u) => !u.trim())}
                                style={{ flex: 1, justifyContent: "center", minWidth: "160px" }}
                            >
                                {scraping
                                    ? <><Loader2 size={14} className="animate-spin" /> Extrayendo con Jina AI…</>
                                    : <><RefreshCw size={14} /> Extraer Información</>}
                            </button>
                        </div>

                        {/* ── Partial error warnings ── */}
                        {scrapeErrors.length > 0 && (
                            <div style={{
                                padding: "10px 14px", borderRadius: "10px", fontSize: "0.78rem",
                                background: "rgba(239,68,68,0.07)",
                                border: "1px solid rgba(239,68,68,0.2)",
                                color: "#f87171", display: "flex", flexDirection: "column", gap: "4px",
                            }}>
                                {scrapeErrors.map((e, i) => <span key={i}>{e}</span>)}
                            </div>
                        )}

                        {/* ── Review textarea ── */}
                        {extractedText !== null && (
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                                <div style={{
                                    display: "flex", alignItems: "center", gap: "6px",
                                    fontSize: "0.68rem", fontWeight: 700,
                                    textTransform: "uppercase", letterSpacing: "0.07em",
                                    color: "var(--text-muted)",
                                }}>
                                    <BookOpen size={11} />
                                    Revisa y corrige el contenido extraído
                                </div>
                                <textarea
                                    className="textarea"
                                    value={extractedText}
                                    onChange={(e) => { setExtractedText(e.target.value); setContextSaved(false); }}
                                    style={{
                                        minHeight: "280px",
                                        fontFamily: "monospace",
                                        fontSize: "0.78rem",
                                        lineHeight: 1.75,
                                        resize: "vertical",
                                    }}
                                />
                                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                                    Puedes editar, corregir o agregar información antes de guardar.
                                    Solo el texto de este cuadro se guardará en la base de conocimiento.
                                </p>

                                {/* Save button */}
                                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                    <button
                                        className="btn-primary"
                                        onClick={handleSaveContext}
                                        disabled={contextSaving || !extractedText.trim()}
                                        style={{
                                            display: "flex", alignItems: "center", gap: "7px",
                                            minWidth: "240px", justifyContent: "center",
                                            ...(contextSaved
                                                ? { background: "rgba(34,197,94,0.12)", color: "var(--success)", border: "1px solid rgba(34,197,94,0.2)" }
                                                : {}),
                                        }}
                                    >
                                        {contextSaving
                                            ? <><Loader2 size={13} className="animate-spin" /> Guardando…</>
                                            : contextSaved
                                                ? <><Check size={13} /> ¡Guardado en la Base de Conocimiento!</>
                                                : <><Database size={13} /> Guardar en la Base de Conocimiento</>}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* ── Current context preview ── */}
                        {currentContext && extractedText === null && (
                            <div>
                                <div style={{
                                    display: "flex", alignItems: "center", gap: "6px",
                                    marginBottom: "8px", fontSize: "0.65rem",
                                    fontWeight: 700, textTransform: "uppercase",
                                    letterSpacing: "0.07em", color: "var(--text-muted)",
                                }}>
                                    <BookOpen size={11} />
                                    Conocimiento actual del bot
                                </div>
                                <div style={{
                                    padding: "12px 14px", borderRadius: "10px",
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    fontSize: "0.75rem", lineHeight: 1.7,
                                    color: "var(--text-secondary)",
                                    maxHeight: "130px", overflowY: "auto",
                                    fontFamily: "monospace",
                                }}>
                                    {currentContext.slice(0, 500)}
                                    {currentContext.length > 500 && <span style={{ color: "var(--text-muted)" }}> …</span>}
                                </div>
                                <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                                    Este texto se inyecta automáticamente en el prompt del bot en cada conversación.
                                </p>
                            </div>
                        )}

                        {!currentContext && extractedText === null && !scraping && (
                            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                                Ingresa una o más URLs (inicio, servicios, FAQ…), extrae la información,
                                revísala y guárdala para que el bot aprenda sobre tu empresa.
                            </p>
                        )}
                    </div>
                </SectionCard>

            </div>
        </div>
    );
}
