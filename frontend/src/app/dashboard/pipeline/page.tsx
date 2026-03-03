"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
    DragDropContext,
    Droppable,
    Draggable,
    type DropResult,
} from "@hello-pangea/dnd";
import { useOrg } from "@/lib/org-context";
import { createClient } from "@supabase/supabase-js";
import type { PipelineStage, Lead, LeadMessage } from "@/lib/types";
import {
    Loader2, Plus, X, User, Phone,
    GripVertical, Users, Edit3, CalendarDays, Save,
    DollarSign, MessageSquare, Tag, Settings, Trash2,
    ChevronUp, ChevronDown, Palette, Activity,
    Bot, MessageCircle,
} from "lucide-react";

/* ── Color palette for stage configuration ─── */
const COLOR_PALETTE = [
    "#3b82f6", "#f59e0b", "#7c3aed", "#10b981",
    "#ef4444", "#06b6d4", "#ec4899", "#8b5cf6",
    "#f97316", "#14b8a6", "#6366f1", "#84cc16",
];

export default function PipelinePage() {
    const { organization } = useOrg();
    const [stages, setStages] = useState<PipelineStage[]>([]);
    const [loading, setLoading] = useState(true);

    /* ── Modal: crear lead ────────────────────────── */
    const [showModal, setShowModal] = useState(false);
    const [newLead, setNewLead] = useState({
        name: "",
        email: "",
        phone: "",
        stage_id: "",
    });
    const [creating, setCreating] = useState(false);

    /* ── Modal: editar lead ───────────────────────── */
    const [editLead, setEditLead] = useState<Lead | null>(null);
    const [editForm, setEditForm] = useState({
        name: "",
        phone: "",
        stage_id: "",
        notes: "",
        budget: "",
        appointment_date: "",
    });
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    /* ── Modal: tabs (Detalles | Chat) ───────────── */
    const [activeTab, setActiveTab] = useState<"details" | "chat">("details");
    const [chatMessages, setChatMessages] = useState<LeadMessage[]>([]);
    const [chatLoading, setChatLoading] = useState(false);
    const [botPaused, setBotPaused] = useState(false);
    const [pauseLoading, setPauseLoading] = useState(false);
    const chatEndRef = useRef<HTMLDivElement>(null);

    /* ── Modal: config stages ────────────────────── */
    const [showConfig, setShowConfig] = useState(false);
    interface EditableStage { id: string; name: string; color: string; position: number; leadCount: number; isNew?: boolean; }
    const [editableStages, setEditableStages] = useState<EditableStage[]>([]);
    const [savingConfig, setSavingConfig] = useState(false);
    const [newStageName, setNewStageName] = useState("");

    /* ── Fetch pipeline ───────────────────────────── */
    const loadPipeline = useCallback(async () => {
        try {
            const res = await fetch(`/api/pipeline?org_id=${organization.id}`);
            const { data } = await res.json();
            if (data) setStages(data);
        } catch (err) {
            console.error("Failed to load pipeline:", err);
        }
        setLoading(false);
    }, [organization.id]);

    useEffect(() => {
        loadPipeline();

        // ── Supabase Realtime: dedicated client for live updates ──
        const realtimeClient = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const channel = realtimeClient
            .channel('pipeline-leads-live')
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'leads',
                    filter: `organization_id=eq.${organization.id}`,
                },
                (payload: any) => {
                    console.log('[Realtime] INSERT received:', payload);
                    const newRecord = payload.new as Lead;
                    if (!newRecord) return;
                    setStages((prev) => {
                        const next = prev.map((s) => ({
                            ...s,
                            leads: s.leads ? s.leads.map((l) => ({ ...l })) : [],
                        }));
                        const col = next.find((s) => s.id === newRecord.stage_id);
                        if (col && !col.leads!.some((l) => l.id === newRecord.id)) {
                            col.leads = [...col.leads!, { ...newRecord }];
                        }
                        return next;
                    });
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'leads',
                    filter: `organization_id=eq.${organization.id}`,
                },
                (payload: any) => {
                    console.log('[Realtime] UPDATE received:', payload);
                    const newRecord = payload.new as Lead;
                    if (!newRecord) return;
                    setStages((prev) => {
                        const next = prev.map((s) => ({
                            ...s,
                            leads: s.leads
                                ? s.leads
                                    .filter((l) => l.id !== newRecord.id)
                                    .map((l) => ({ ...l }))
                                : [],
                        }));
                        // Insert into correct stage
                        const col = next.find((s) => s.id === newRecord.stage_id);
                        if (col) {
                            col.leads = [...col.leads!, { ...newRecord }];
                        }
                        return next;
                    });
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'leads',
                    filter: `organization_id=eq.${organization.id}`,
                },
                (payload: any) => {
                    console.log('[Realtime] DELETE received:', payload);
                    const oldRecord = payload.old as { id?: string };
                    if (!oldRecord?.id) return;
                    setStages((prev) => {
                        return prev.map((s) => ({
                            ...s,
                            leads: (s.leads || []).filter((l) => l.id !== oldRecord.id).map((l) => ({ ...l })),
                        }));
                    });
                }
            )
            .subscribe((status) => {
                console.log('[Realtime] Subscription status:', status);
            });

        return () => {
            realtimeClient.removeChannel(channel);
        };
    }, [loadPipeline, organization.id]);

    /* ── Drag & Drop handler (optimistic) ─────────── */
    const onDragEnd = async (result: DropResult) => {
        const { source, destination, draggableId } = result;
        if (!destination) return;
        if (
            source.droppableId === destination.droppableId &&
            source.index === destination.index
        )
            return;

        const destStageId = destination.droppableId;

        setStages((prev) => {
            const next = prev.map((s) => ({
                ...s,
                leads: [...(s.leads || [])],
            }));
            const srcCol = next.find((s) => s.id === source.droppableId);
            const dstCol = next.find((s) => s.id === destStageId);
            if (!srcCol || !dstCol) return prev;
            const [moved] = srcCol.leads!.splice(source.index, 1);
            moved.stage_id = destStageId;
            dstCol.leads!.splice(destination.index, 0, moved);
            return next;
        });

        try {
            await fetch(`/api/pipeline/leads/${draggableId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ stage_id: destStageId }),
            });
        } catch (err) {
            console.error("Failed to update lead stage:", err);
            loadPipeline();
        }
    };

    /* ── Create lead ──────────────────────────────── */
    const handleCreateLead = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newLead.name.trim()) return;
        setCreating(true);

        const stageId = newLead.stage_id || stages[0]?.id;
        if (!stageId) return;

        try {
            const res = await fetch("/api/pipeline/leads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    organization_id: organization.id,
                    stage_id: stageId,
                    name: newLead.name.trim(),
                    email: newLead.email.trim(),
                    phone: newLead.phone.trim(),
                }),
            });
            const { data } = await res.json();

            if (data) {
                setStages((prev) =>
                    prev.map((s) =>
                        s.id === stageId
                            ? { ...s, leads: [...(s.leads || []), data] }
                            : s
                    )
                );
            }

            setNewLead({ name: "", email: "", phone: "", stage_id: "" });
            setShowModal(false);
        } catch (err) {
            console.error("Failed to create lead:", err);
        }
        setCreating(false);
    };

    /* ── Open edit modal ──────────────────────────── */
    const openEditModal = (lead: Lead) => {
        setEditLead(lead);
        setEditForm({
            name: lead.name,
            phone: lead.phone || "",
            stage_id: lead.stage_id,
            notes: lead.notes || "",
            budget: lead.budget || "",
            appointment_date: lead.appointment_date || "",
        });
        // Reset tab state
        setActiveTab("details");
        setChatMessages([]);
        setBotPaused(lead.is_bot_paused ?? false);
    };

    /* ── Fetch chat messages ───────────────────────── */
    const fetchChatMessages = useCallback(async (leadId: string) => {
        setChatLoading(true);
        try {
            const res = await fetch(`/api/pipeline/leads/${leadId}/messages`);
            const { data } = await res.json();
            setChatMessages(data || []);
        } catch (err) {
            console.error("Failed to load chat messages:", err);
        }
        setChatLoading(false);
    }, []);

    /* ── Auto-scroll chat to bottom ───────────────── */
    useEffect(() => {
        if (activeTab === "chat" && chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [chatMessages, activeTab]);

    /* ── Chat tab click → fetch messages ──────────── */
    const handleChatTabClick = () => {
        setActiveTab("chat");
        if (editLead) fetchChatMessages(editLead.id);
    };

    /* ── Toggle bot pause ─────────────────────────── */
    const handleToggleBotPause = async () => {
        if (!editLead || pauseLoading) return;
        const newPaused = !botPaused;
        setPauseLoading(true);
        setBotPaused(newPaused); // optimistic
        try {
            await fetch(`/api/pipeline/leads/${editLead.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ is_bot_paused: newPaused }),
            });
            // Update local pipeline state so it survives modal close
            setStages((prev) =>
                prev.map((s) => ({
                    ...s,
                    leads: (s.leads || []).map((l) =>
                        l.id === editLead.id ? { ...l, is_bot_paused: newPaused } : l
                    ),
                }))
            );
        } catch (err) {
            console.error("Failed to toggle bot pause:", err);
            setBotPaused(!newPaused); // revert on error
        }
        setPauseLoading(false);
    };

    /* ── Save edited lead ─────────────────────────── */
    const handleSaveLead = async () => {
        if (!editLead) return;
        setSaving(true);
        try {
            await fetch(`/api/pipeline/leads/${editLead.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: editForm.name.trim(),
                    phone: editForm.phone.trim(),
                    stage_id: editForm.stage_id,
                    notes: editForm.notes.trim(),
                    budget: editForm.budget.trim(),
                    appointment_date: editForm.appointment_date.trim(),
                }),
            });
            await loadPipeline();
            setEditLead(null);
        } catch (err) {
            console.error("Failed to update lead:", err);
        }
        setSaving(false);
    };

    /* ── Delete lead ──────────────────────────────── */
    const handleDeleteLead = async () => {
        if (!editLead) return;
        const confirmed = window.confirm(
            `¿Eliminar a "${editLead.name}" del pipeline? Esta acción no se puede deshacer.`
        );
        if (!confirmed) return;
        setDeleting(true);
        try {
            await fetch(`/api/pipeline/leads/${editLead.id}`, { method: "DELETE" });
            // Optimistic UI: remove from local state immediately
            setStages((prev) =>
                prev.map((s) => ({
                    ...s,
                    leads: (s.leads || []).filter((l) => l.id !== editLead.id),
                }))
            );
            setEditLead(null);
        } catch (err) {
            console.error("Failed to delete lead:", err);
        }
        setDeleting(false);
    };

    /* ── Helper: source badge ─────────────────────── */
    const getSourceBadge = (lead: Lead) => {
        const src = lead.source || "manual";
        if (src === "whatsapp" || lead.name?.toLowerCase().includes("whatsapp")) {
            return (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[0.65rem] font-semibold text-green-400">
                    WhatsApp
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[0.65rem] font-semibold text-blue-400">
                Manual
            </span>
        );
    };

    /* ── Helper: status badge ─────────────────────── */
    const getStatusBadge = (lead: Lead) => {
        const isQualified = !!lead.appointment_date;
        if (isQualified) {
            return (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[0.65rem] font-bold text-emerald-400 ring-1 ring-emerald-500/20">
                    ✓ Calificado
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-500/15 px-2 py-0.5 text-[0.65rem] font-bold text-zinc-400 ring-1 ring-zinc-500/20">
                Pendiente
            </span>
        );
    };

    /* ── Helper: chat status live badge ────────────── */
    const getChatStatusBadge = (lead: Lead) => {
        const status = lead.chat_status || "Nuevo";
        const statusConfig: Record<string, { color: string; bg: string; ring: string; pulse: boolean }> = {
            "Nuevo": { color: "text-zinc-400", bg: "bg-zinc-500/10", ring: "ring-zinc-500/20", pulse: false },
            "Contacto inicial": { color: "text-blue-400", bg: "bg-blue-500/10", ring: "ring-blue-500/20", pulse: true },
            "Consultando opciones": { color: "text-blue-400", bg: "bg-blue-500/10", ring: "ring-blue-500/20", pulse: true },
            "Filtrando perfil": { color: "text-amber-400", bg: "bg-amber-500/10", ring: "ring-amber-500/20", pulse: true },
            "Negociando horario": { color: "text-amber-400", bg: "bg-amber-500/10", ring: "ring-amber-500/20", pulse: true },
            "Cita agendada": { color: "text-emerald-400", bg: "bg-emerald-500/10", ring: "ring-emerald-500/20", pulse: false },
            "Derivado a humano": { color: "text-orange-400", bg: "bg-orange-500/10", ring: "ring-orange-500/20", pulse: true },
            "Esperando respuesta": { color: "text-violet-400", bg: "bg-violet-500/10", ring: "ring-violet-500/20", pulse: true },
            "Descartado": { color: "text-red-400", bg: "bg-red-500/10", ring: "ring-red-500/20", pulse: false },
        };
        const cfg = statusConfig[status] || statusConfig["Nuevo"];

        return (
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full ${cfg.bg} ring-1 ${cfg.ring}`}>
                <span className="relative flex h-2 w-2">
                    {cfg.pulse && (
                        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${cfg.bg}`} />
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.bg.replace('/10', '/70')}`} />
                </span>
                <span className={`text-[0.6rem] font-semibold ${cfg.color}`}>
                    {status}
                </span>
            </div>
        );
    };

    /* ── Stage color accents (dynamic from DB or fallback) ── */
    const FALLBACK_COLORS = ["#3b82f6", "#f59e0b", "#7c3aed", "#10b981"];
    const getStageColor = (stage: PipelineStage, idx: number) => {
        const dot = stage.color || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
        return {
            bg: `${dot}1f`,
            border: `${dot}4d`,
            dot,
        };
    };

    /* ── Open config modal ────────────────────────── */
    const openConfigModal = () => {
        setEditableStages(
            stages.map((s) => ({
                id: s.id,
                name: s.name,
                color: s.color || FALLBACK_COLORS[stages.indexOf(s) % FALLBACK_COLORS.length],
                position: s.position,
                leadCount: s.leads?.length || 0,
            }))
        );
        setNewStageName("");
        setShowConfig(true);
    };

    /* ── Config: add stage ─────────────────────────── */
    const handleAddStage = () => {
        if (!newStageName.trim()) return;
        const maxPos = editableStages.length > 0
            ? Math.max(...editableStages.map((s) => s.position))
            : -1;
        setEditableStages((prev) => [
            ...prev,
            {
                id: `new-${Date.now()}`,
                name: newStageName.trim(),
                color: COLOR_PALETTE[prev.length % COLOR_PALETTE.length],
                position: maxPos + 1,
                leadCount: 0,
                isNew: true,
            },
        ]);
        setNewStageName("");
    };

    /* ── Config: move stage up/down ────────────────── */
    const moveStage = (idx: number, dir: -1 | 1) => {
        const newIdx = idx + dir;
        if (newIdx < 0 || newIdx >= editableStages.length) return;
        setEditableStages((prev) => {
            const next = [...prev];
            [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
            return next.map((s, i) => ({ ...s, position: i }));
        });
    };

    /* ── Config: delete stage ──────────────────────── */
    const handleDeleteStage = (idx: number) => {
        const stage = editableStages[idx];
        if (stage.leadCount > 0 && !stage.isNew) {
            alert("No puedes eliminar una etapa con leads. Muévelos primero.");
            return;
        }
        setEditableStages((prev) =>
            prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, position: i }))
        );
    };

    /* ── Config: save all changes ──────────────────── */
    const handleSaveConfig = async () => {
        setSavingConfig(true);
        try {
            // 1. Create new stages
            for (const s of editableStages.filter((s) => s.isNew)) {
                await fetch("/api/pipeline/stages", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        organization_id: organization.id,
                        name: s.name,
                        color: s.color,
                        position: s.position,
                    }),
                });
            }

            // 2. Update existing stages (name, color)
            for (const s of editableStages.filter((s) => !s.isNew)) {
                await fetch(`/api/pipeline/stages/${s.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: s.name,
                        color: s.color,
                    }),
                });
            }

            // 3. Batch reorder
            const orderPayload = editableStages
                .filter((s) => !s.isNew)
                .map((s) => ({ id: s.id, position: s.position }));
            if (orderPayload.length > 0) {
                await fetch("/api/pipeline/stages", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ stages: orderPayload }),
                });
            }

            // 4. Delete removed stages
            const currentIds = new Set(editableStages.map((s) => s.id));
            const deletedStages = stages.filter((s) => !currentIds.has(s.id));
            for (const s of deletedStages) {
                await fetch(`/api/pipeline/stages/${s.id}`, { method: "DELETE" });
            }

            // Reload pipeline
            setShowConfig(false);
            setLoading(true);
            await loadPipeline();
        } catch (err) {
            console.error("Failed to save config:", err);
        }
        setSavingConfig(false);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-32">
                <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
        );
    }

    return (
        <div className="animate-in" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
            {/* ── Header ──────────────────────────────── */}
            <div className="page-header" style={{ flexShrink: 0 }}>
                <div>
                    <h1 className="page-title">Flujo de Ventas</h1>
                    <p className="page-subtitle">
                        Gestiona tus leads a través del embudo de ventas
                    </p>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                    <button
                        className="btn-secondary"
                        onClick={openConfigModal}
                    >
                        <Settings size={16} /> Configurar Etapas
                    </button>
                    <button
                        className="btn-primary"
                        onClick={() => setShowModal(true)}
                    >
                        <Plus size={18} /> Nuevo Cliente
                    </button>
                </div>
            </div>

            {/* ── Kanban Board ────────────────────────── */}
            <DragDropContext onDragEnd={onDragEnd}>
                <div
                    style={{
                        display: "flex",
                        gap: "16px",
                        flex: 1,
                        overflowX: "auto",
                        overflowY: "hidden",
                        paddingBottom: "16px",
                    }}
                >
                    {stages.map((stage, idx) => {
                        const color = getStageColor(stage, idx);
                        const leadCount = stage.leads?.length || 0;

                        return (
                            <div
                                key={stage.id}
                                style={{
                                    minWidth: "320px",
                                    maxWidth: "360px",
                                    flex: "1 0 320px",
                                    display: "flex",
                                    flexDirection: "column",
                                    background: "var(--bg-secondary)",
                                    borderRadius: "var(--radius-lg)",
                                    border: "1px solid var(--border)",
                                    overflow: "hidden",
                                }}
                            >
                                {/* Column header */}
                                <div
                                    style={{
                                        padding: "16px 18px",
                                        borderBottom: `2px solid ${color.border}`,
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                    }}
                                >
                                    <div
                                        style={{
                                            width: "10px",
                                            height: "10px",
                                            borderRadius: "50%",
                                            background: color.dot,
                                            flexShrink: 0,
                                        }}
                                    />
                                    <span
                                        style={{
                                            fontSize: "0.85rem",
                                            fontWeight: 600,
                                            color: "var(--text-primary)",
                                            flex: 1,
                                        }}
                                    >
                                        {stage.name}
                                    </span>
                                    <span
                                        style={{
                                            fontSize: "0.7rem",
                                            fontWeight: 700,
                                            color: color.dot,
                                            background: color.bg,
                                            padding: "3px 10px",
                                            borderRadius: "100px",
                                        }}
                                    >
                                        {leadCount}
                                    </span>
                                </div>

                                {/* Droppable area */}
                                <Droppable droppableId={stage.id}>
                                    {(provided, snapshot) => (
                                        <div
                                            ref={provided.innerRef}
                                            {...provided.droppableProps}
                                            style={{
                                                flex: 1,
                                                overflowY: "auto",
                                                padding: "10px",
                                                minHeight: "120px",
                                                transition: "background 0.2s ease",
                                                background: snapshot.isDraggingOver
                                                    ? color.bg
                                                    : "transparent",
                                            }}
                                        >
                                            {(stage.leads || []).map(
                                                (lead, leadIdx) => (
                                                    <Draggable
                                                        key={lead.id}
                                                        draggableId={lead.id}
                                                        index={leadIdx}
                                                    >
                                                        {(prov, snap) => (
                                                            <div
                                                                ref={prov.innerRef}
                                                                {...prov.draggableProps}
                                                                {...prov.dragHandleProps}
                                                                onClick={() => openEditModal(lead)}
                                                                className="group"
                                                                style={{
                                                                    ...prov.draggableProps.style,
                                                                    marginBottom: "10px",
                                                                }}
                                                            >
                                                                {/* ═══ ENHANCED LEAD CARD ═══ */}
                                                                <div
                                                                    className={`
                                                                        rounded-xl border transition-all duration-200 cursor-pointer
                                                                        ${snap.isDragging
                                                                            ? "border-violet-500/50 bg-[var(--bg-card-hover)] shadow-[0_0_30px_rgba(124,58,237,0.15)]"
                                                                            : "border-[var(--border)] bg-[var(--bg-card)] hover:border-violet-500/30 hover:bg-[var(--bg-card-hover)] hover:shadow-lg"
                                                                        }
                                                                    `}
                                                                >
                                                                    {/* Row 1: Grip + Name + Source */}
                                                                    <div className="flex items-center gap-2 px-3.5 pt-3 pb-1.5">
                                                                        <GripVertical size={13} className="text-zinc-600 shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" />
                                                                        <span className="font-semibold text-[0.82rem] text-[var(--text-primary)] truncate flex-1">
                                                                            {lead.name}
                                                                        </span>
                                                                        {getSourceBadge(lead)}
                                                                    </div>

                                                                    {/* Row 2: Phone + Status Badge */}
                                                                    <div className="flex items-center justify-between px-3.5 pb-1">
                                                                        {lead.phone ? (
                                                                            <div className="flex items-center gap-1.5 text-[0.72rem] text-[var(--text-secondary)]">
                                                                                <Phone size={11} className="text-zinc-500" />
                                                                                <span>{lead.phone}</span>
                                                                            </div>
                                                                        ) : (
                                                                            <span className="text-[0.72rem] text-zinc-600 italic">Sin teléfono</span>
                                                                        )}
                                                                        {getStatusBadge(lead)}
                                                                    </div>

                                                                    {/* Row 2.5: Live Chat Status */}
                                                                    <div className="flex items-center gap-1.5 px-3.5 pb-2">
                                                                        <Activity size={10} className="text-zinc-500 shrink-0" />
                                                                        {getChatStatusBadge(lead)}
                                                                    </div>

                                                                    {/* Row 3: Data Grid */}
                                                                    <div className="mx-3 mb-3 mt-1 rounded-lg bg-white/[0.03] border border-white/[0.04] grid grid-cols-2 divide-x divide-white/[0.04]">
                                                                        <div className="px-3 py-2">
                                                                            <div className="flex items-center gap-1 text-[0.62rem] uppercase tracking-wider text-zinc-500 mb-0.5">
                                                                                <DollarSign size={10} />
                                                                                Monto
                                                                            </div>
                                                                            <div className="text-[0.78rem] font-medium text-[var(--text-primary)] truncate">
                                                                                {lead.budget || "—"}
                                                                            </div>
                                                                        </div>
                                                                        <div className="px-3 py-2">
                                                                            <div className="flex items-center gap-1 text-[0.62rem] uppercase tracking-wider text-zinc-500 mb-0.5">
                                                                                <CalendarDays size={10} />
                                                                                Fecha Cita
                                                                            </div>
                                                                            <div className={`text-[0.78rem] font-medium truncate ${lead.appointment_date ? "text-emerald-400" : "text-[var(--text-primary)]"}`}>
                                                                                {lead.appointment_date || "—"}
                                                                            </div>
                                                                        </div>
                                                                    </div>

                                                                    {/* Row 4: Notes preview (optional) */}
                                                                    {lead.notes && (
                                                                        <div className="px-3.5 pb-2.5">
                                                                            <p className="text-[0.7rem] text-zinc-500 truncate italic">
                                                                                📝 {lead.notes}
                                                                            </p>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                )
                                            )}
                                            {provided.placeholder}

                                            {/* Empty column state */}
                                            {leadCount === 0 && (
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        padding: "32px 16px",
                                                        color: "var(--text-muted)",
                                                        fontSize: "0.75rem",
                                                        gap: "8px",
                                                    }}
                                                >
                                                    <Users size={24} style={{ opacity: 0.3 }} />
                                                    <span>Sin leads</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </Droppable>
                            </div>
                        );
                    })}
                </div>
            </DragDropContext>

            {/* ── Modal: Nuevo Cliente ─────────────────── */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                        style={{ maxWidth: "480px" }}
                    >
                        <div className="modal-header">
                            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <div
                                    style={{
                                        width: "36px",
                                        height: "36px",
                                        borderRadius: "10px",
                                        background: "rgba(255,255,255,0.05)",
                                        border: "1px solid rgba(255,255,255,0.07)",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                    }}
                                >
                                    <User size={18} color="white" />
                                </div>
                                <div>
                                    <h3
                                        style={{
                                            fontSize: "1rem",
                                            fontWeight: 700,
                                            color: "var(--text-primary)",
                                        }}
                                    >
                                        Nuevo Cliente
                                    </h3>
                                    <p
                                        style={{
                                            fontSize: "0.75rem",
                                            color: "var(--text-muted)",
                                        }}
                                    >
                                        Agrega un lead al pipeline
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowModal(false)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    color: "var(--text-muted)",
                                    cursor: "pointer",
                                    padding: "4px",
                                }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreateLead}>
                            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Nombre *</label>
                                    <input
                                        className="input"
                                        value={newLead.name}
                                        onChange={(e) =>
                                            setNewLead((p) => ({
                                                ...p,
                                                name: e.target.value,
                                            }))
                                        }
                                        placeholder="Juan Pérez"
                                        required
                                        autoFocus
                                    />
                                </div>

                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Email</label>
                                    <input
                                        className="input"
                                        type="email"
                                        value={newLead.email}
                                        onChange={(e) =>
                                            setNewLead((p) => ({
                                                ...p,
                                                email: e.target.value,
                                            }))
                                        }
                                        placeholder="juan@email.com"
                                    />
                                </div>

                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Teléfono</label>
                                    <input
                                        className="input"
                                        value={newLead.phone}
                                        onChange={(e) =>
                                            setNewLead((p) => ({
                                                ...p,
                                                phone: e.target.value,
                                            }))
                                        }
                                        placeholder="+56 9 1234 5678"
                                    />
                                </div>

                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label className="form-label">Etapa Inicial</label>
                                    <select
                                        className="select"
                                        value={newLead.stage_id || stages[0]?.id || ""}
                                        onChange={(e) =>
                                            setNewLead((p) => ({
                                                ...p,
                                                stage_id: e.target.value,
                                            }))
                                        }
                                    >
                                        {stages.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() => setShowModal(false)}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn-primary"
                                    disabled={creating || !newLead.name.trim()}
                                >
                                    {creating ? (
                                        <><Loader2 size={15} className="animate-spin" />{" "}
                                            Guardando…
                                        </>
                                    ) : (
                                        <>
                                            <Plus size={16} /> Agregar Lead
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════ */}
            {/* ── Modal: Editar Lead (2 tabs) ────────── */}
            {/* ══════════════════════════════════════════ */}
            {editLead && (
                <div className="modal-overlay" onClick={() => setEditLead(null)}>
                    <div
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                        style={{ maxWidth: "540px" }}
                    >
                        {/* ── Header ────────────────────────────── */}
                        <div className="modal-header" style={{ flexDirection: "column", gap: "12px", paddingBottom: "0" }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                                <div className="flex items-center gap-3">
                                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center">
                                        <Edit3 size={18} color="white" />
                                    </div>
                                    <div>
                                        <h3 className="text-base font-bold text-[var(--text-primary)]">
                                            {editLead.name}
                                        </h3>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {editLead.phone || "Sin teléfono"}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setEditLead(null)}
                                    className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            {/* ── Tab Bar ──────────────────────────────── */}
                            <div style={{
                                display: "flex",
                                gap: "4px",
                                padding: "4px",
                                background: "rgba(255,255,255,0.04)",
                                borderRadius: "10px",
                                border: "1px solid rgba(255,255,255,0.06)",
                            }}>
                                <button
                                    onClick={() => setActiveTab("details")}
                                    style={{
                                        flex: 1,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "6px",
                                        padding: "7px 12px",
                                        borderRadius: "7px",
                                        border: "none",
                                        cursor: "pointer",
                                        fontSize: "0.8rem",
                                        fontWeight: 600,
                                        transition: "all 0.2s ease",
                                        background: activeTab === "details" ? "rgba(255,255,255,0.1)" : "transparent",
                                        color: activeTab === "details" ? "var(--text-primary)" : "var(--text-muted)",
                                    }}
                                >
                                    <Edit3 size={13} />
                                    Detalles
                                </button>
                                <button
                                    onClick={handleChatTabClick}
                                    style={{
                                        flex: 1,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: "6px",
                                        padding: "7px 12px",
                                        borderRadius: "7px",
                                        border: "none",
                                        cursor: "pointer",
                                        fontSize: "0.8rem",
                                        fontWeight: 600,
                                        transition: "all 0.2s ease",
                                        background: activeTab === "chat" ? "rgba(255,255,255,0.1)" : "transparent",
                                        color: activeTab === "chat" ? "var(--text-primary)" : "var(--text-muted)",
                                    }}
                                >
                                    <MessageCircle size={13} />
                                    💬 Chat
                                    {chatMessages.length > 0 && (
                                        <span style={{
                                            fontSize: "0.6rem",
                                            fontWeight: 700,
                                            background: "rgba(59,130,246,0.25)",
                                            color: "#60a5fa",
                                            padding: "1px 6px",
                                            borderRadius: "100px",
                                        }}>
                                            {chatMessages.length}
                                        </span>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* ════════════════════════════════════════ */}
                        {/* ── TAB: DETALLES ──────────────────────  */}
                        {/* ════════════════════════════════════════ */}
                        {activeTab === "details" && (
                            <>
                                <div className="modal-body flex flex-col gap-4">

                                    {/* ── Bot Pause Toggle ────────────────── */}
                                    <button
                                        type="button"
                                        onClick={handleToggleBotPause}
                                        disabled={pauseLoading}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "12px 16px",
                                            borderRadius: "12px",
                                            border: `1px solid ${botPaused ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
                                            background: botPaused ? "rgba(239,68,68,0.07)" : "rgba(34,197,94,0.07)",
                                            cursor: pauseLoading ? "not-allowed" : "pointer",
                                            transition: "all 0.3s ease",
                                            opacity: pauseLoading ? 0.7 : 1,
                                            width: "100%",
                                            textAlign: "left",
                                        }}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                            {pauseLoading ? (
                                                <Loader2 size={16} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                                            ) : (
                                                <Bot size={16} style={{ color: botPaused ? "#f87171" : "#4ade80" }} />
                                            )}
                                            <div>
                                                <div style={{
                                                    fontSize: "0.82rem",
                                                    fontWeight: 700,
                                                    color: botPaused ? "#f87171" : "#4ade80",
                                                }}>
                                                    {botPaused ? "⏸️ IA Pausada" : "🤖 IA Activa"}
                                                </div>
                                                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "1px" }}>
                                                    {botPaused
                                                        ? "El bot no responderá. Toma el control manualmente."
                                                        : "El bot responde automáticamente por WhatsApp."}
                                                </div>
                                            </div>
                                        </div>
                                        {/* Toggle pill */}
                                        <div style={{
                                            width: "44px",
                                            height: "24px",
                                            borderRadius: "100px",
                                            background: botPaused ? "rgba(239,68,68,0.4)" : "rgba(34,197,94,0.4)",
                                            border: `1px solid ${botPaused ? "rgba(239,68,68,0.5)" : "rgba(34,197,94,0.5)"}`,
                                            position: "relative",
                                            flexShrink: 0,
                                            transition: "all 0.3s ease",
                                        }}>
                                            <div style={{
                                                width: "18px",
                                                height: "18px",
                                                borderRadius: "50%",
                                                background: botPaused ? "#f87171" : "#4ade80",
                                                position: "absolute",
                                                top: "2px",
                                                left: botPaused ? "22px" : "3px",
                                                transition: "left 0.3s ease, background 0.3s ease",
                                                boxShadow: `0 0 6px ${botPaused ? "rgba(239,68,68,0.6)" : "rgba(34,197,94,0.6)"}`,
                                            }} />
                                        </div>
                                    </button>

                                    {/* ── Row: Name + Phone ─────────────── */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">
                                                <User size={12} className="inline mr-1 align-middle" />
                                                Nombre
                                            </label>
                                            <input
                                                className="input"
                                                value={editForm.name}
                                                onChange={(e) =>
                                                    setEditForm((p) => ({
                                                        ...p,
                                                        name: e.target.value,
                                                    }))
                                                }
                                                placeholder="Nombre del lead"
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">
                                                <Phone size={12} className="inline mr-1 align-middle" />
                                                Teléfono
                                            </label>
                                            <input
                                                className="input"
                                                value={editForm.phone}
                                                onChange={(e) =>
                                                    setEditForm((p) => ({
                                                        ...p,
                                                        phone: e.target.value,
                                                    }))
                                                }
                                                placeholder="+56 9 1234 5678"
                                            />
                                        </div>
                                    </div>

                                    {/* Stage */}
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">
                                            <Tag size={12} className="inline mr-1 align-middle" />
                                            Etapa
                                        </label>
                                        <select
                                            className="select"
                                            value={editForm.stage_id}
                                            onChange={(e) =>
                                                setEditForm((p) => ({
                                                    ...p,
                                                    stage_id: e.target.value,
                                                }))
                                            }
                                        >
                                            {stages.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Row: Budget + Appointment Date */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">
                                                <DollarSign size={12} className="inline mr-1 align-middle" />
                                                Monto / Valor
                                            </label>
                                            <input
                                                className="input"
                                                value={editForm.budget}
                                                onChange={(e) =>
                                                    setEditForm((p) => ({
                                                        ...p,
                                                        budget: e.target.value,
                                                    }))
                                                }
                                                placeholder="Ej: $50.000.000"
                                            />
                                        </div>
                                        <div className="form-group" style={{ marginBottom: 0 }}>
                                            <label className="form-label">
                                                <CalendarDays size={12} className="inline mr-1 align-middle" />
                                                Fecha de Cita
                                            </label>
                                            <input
                                                className="input"
                                                value={editForm.appointment_date}
                                                onChange={(e) =>
                                                    setEditForm((p) => ({
                                                        ...p,
                                                        appointment_date: e.target.value,
                                                    }))
                                                }
                                                placeholder="26 Feb, 10:00 am"
                                            />
                                        </div>
                                    </div>

                                    {/* Notes */}
                                    <div className="form-group" style={{ marginBottom: 0 }}>
                                        <label className="form-label">
                                            <MessageSquare size={12} className="inline mr-1 align-middle" />
                                            Notas
                                        </label>
                                        <textarea
                                            className="input"
                                            rows={3}
                                            value={editForm.notes}
                                            onChange={(e) =>
                                                setEditForm((p) => ({
                                                    ...p,
                                                    notes: e.target.value,
                                                }))
                                            }
                                            placeholder="Ej: Detalles del servicio, producto requerido o notas adicionales del cliente..."
                                            style={{ resize: "vertical", minHeight: "70px" }}
                                        />
                                    </div>
                                </div>

                                {/* Footer */}
                                <div className="modal-footer" style={{ justifyContent: "space-between" }}>
                                    <button
                                        type="button"
                                        onClick={handleDeleteLead}
                                        disabled={deleting || saving}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "6px",
                                            padding: "8px 14px",
                                            borderRadius: "10px",
                                            border: "1px solid rgba(239,68,68,0.35)",
                                            background: "rgba(239,68,68,0.08)",
                                            color: deleting ? "var(--text-muted)" : "#f87171",
                                            cursor: deleting ? "not-allowed" : "pointer",
                                            fontSize: "0.82rem",
                                            fontWeight: 600,
                                            transition: "all 0.2s ease",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!deleting) {
                                                e.currentTarget.style.background = "rgba(239,68,68,0.18)";
                                                e.currentTarget.style.borderColor = "rgba(239,68,68,0.6)";
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                                            e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                                        }}
                                    >
                                        {deleting ? (
                                            <><Loader2 size={13} className="animate-spin" /> Eliminando…</>
                                        ) : (
                                            <><Trash2 size={14} /> Eliminar Prospecto</>
                                        )}
                                    </button>

                                    <div style={{ display: "flex", gap: "8px" }}>
                                        <button
                                            type="button"
                                            className="btn-secondary"
                                            onClick={() => setEditLead(null)}
                                        >
                                            Cancelar
                                        </button>
                                        <button
                                            type="button"
                                            className="btn-primary"
                                            disabled={saving || !editForm.name.trim()}
                                            onClick={handleSaveLead}
                                        >
                                            {saving ? (
                                                <><Loader2 size={15} className="animate-spin" /> Guardando…</>
                                            ) : (
                                                <><Save size={16} /> Guardar Cambios</>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}

                        {/* ════════════════════════════════════════ */}
                        {/* ── TAB: CHAT (MODO ESPÍA) ─────────────  */}
                        {/* ════════════════════════════════════════ */}
                        {activeTab === "chat" && (
                            <div className="modal-body" style={{ padding: "0" }}>

                                {/* Spy Mode banner */}
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                    padding: "8px 20px",
                                    background: "rgba(124,58,237,0.08)",
                                    borderBottom: "1px solid rgba(124,58,237,0.15)",
                                }}>
                                    <span style={{ fontSize: "0.68rem", color: "#a78bfa", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                                        👁️ Modo Espía — Historial de conversación
                                    </span>
                                </div>

                                {/* Message list */}
                                <div style={{
                                    height: "420px",
                                    overflowY: "auto",
                                    padding: "16px 20px",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "10px",
                                    background: "var(--bg-primary)",
                                }}>
                                    {chatLoading ? (
                                        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", flex: 1 }}>
                                            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                                        </div>
                                    ) : chatMessages.length === 0 ? (
                                        <div style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            flex: 1,
                                            gap: "8px",
                                            color: "var(--text-muted)",
                                        }}>
                                            <MessageCircle size={32} style={{ opacity: 0.3 }} />
                                            <span style={{ fontSize: "0.8rem" }}>Sin mensajes registrados aún</span>
                                            <span style={{ fontSize: "0.7rem", opacity: 0.6 }}>Los mensajes se guardan a partir de ahora</span>
                                        </div>
                                    ) : (
                                        chatMessages.map((msg) => {
                                            const isUser = msg.role === "user";
                                            const time = new Date(msg.created_at).toLocaleTimeString("es-CL", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            });
                                            return (
                                                <div
                                                    key={msg.id}
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        alignItems: isUser ? "flex-start" : "flex-end",
                                                        gap: "3px",
                                                    }}
                                                >
                                                    <div style={{
                                                        maxWidth: "78%",
                                                        padding: "9px 13px",
                                                        borderRadius: isUser ? "4px 16px 16px 16px" : "16px 4px 16px 16px",
                                                        background: isUser ? "rgba(255,255,255,0.07)" : "rgba(59,130,246,0.75)",
                                                        border: isUser ? "1px solid rgba(255,255,255,0.08)" : "none",
                                                        fontSize: "0.82rem",
                                                        lineHeight: 1.5,
                                                        color: isUser ? "var(--text-primary)" : "#fff",
                                                        wordBreak: "break-word",
                                                        backdropFilter: "blur(4px)",
                                                    }}>
                                                        {msg.content}
                                                    </div>
                                                    <span style={{
                                                        fontSize: "0.62rem",
                                                        color: "var(--text-muted)",
                                                        paddingLeft: isUser ? "4px" : "0",
                                                        paddingRight: isUser ? "0" : "4px",
                                                    }}>
                                                        {isUser ? `👤 Cliente · ${time}` : `🤖 Bot · ${time}`}
                                                    </span>
                                                </div>
                                            );
                                        })
                                    )}
                                    {/* Auto-scroll anchor */}
                                    <div ref={chatEndRef} />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ══════════════════════════════════════════ */}
            {/* ── Modal: Configurar Etapas ───────────────  */}
            {/* ══════════════════════════════════════════ */}
            {showConfig && (
                <div className="modal-overlay" onClick={() => setShowConfig(false)}>
                    <div
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                        style={{ maxWidth: "560px" }}
                    >
                        {/* Header */}
                        <div className="modal-header">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-blue-500 flex items-center justify-center">
                                    <Settings size={18} color="white" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-[var(--text-primary)]">
                                        Configurar Etapas
                                    </h3>
                                    <p className="text-xs text-[var(--text-muted)]">
                                        Agrega, renombra, reordena o elimina columnas del pipeline
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={() => setShowConfig(false)}
                                className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors bg-transparent border-none cursor-pointer"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="modal-body flex flex-col gap-3">
                            {editableStages.map((stage, idx) => (
                                <div
                                    key={stage.id}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "10px",
                                        padding: "10px 14px",
                                        borderRadius: "var(--radius)",
                                        background: "var(--bg-card)",
                                        border: "1px solid var(--border)",
                                    }}
                                >
                                    {/* Position number */}
                                    <span style={{
                                        fontSize: "0.7rem",
                                        fontWeight: 700,
                                        color: "var(--text-muted)",
                                        width: "20px",
                                        textAlign: "center",
                                    }}>
                                        {idx + 1}
                                    </span>

                                    {/* Color picker */}
                                    <div style={{ position: "relative" }}>
                                        <div
                                            style={{
                                                width: "28px",
                                                height: "28px",
                                                borderRadius: "8px",
                                                background: stage.color,
                                                cursor: "pointer",
                                                border: "2px solid rgba(255,255,255,0.1)",
                                                position: "relative",
                                            }}
                                            onClick={() => {
                                                // Cycle through palette
                                                const currentIdx = COLOR_PALETTE.indexOf(stage.color);
                                                const nextColor = COLOR_PALETTE[(currentIdx + 1) % COLOR_PALETTE.length];
                                                setEditableStages((prev) =>
                                                    prev.map((s, i) =>
                                                        i === idx ? { ...s, color: nextColor } : s
                                                    )
                                                );
                                            }}
                                            title="Click para cambiar color"
                                        >
                                            <Palette size={12} color="white" style={{
                                                position: "absolute",
                                                top: "50%", left: "50%",
                                                transform: "translate(-50%, -50%)",
                                                opacity: 0.7,
                                            }} />
                                        </div>
                                    </div>

                                    {/* Name input */}
                                    <input
                                        className="input"
                                        value={stage.name}
                                        onChange={(e) =>
                                            setEditableStages((prev) =>
                                                prev.map((s, i) =>
                                                    i === idx ? { ...s, name: e.target.value } : s
                                                )
                                            )
                                        }
                                        style={{ flex: 1, padding: "8px 12px", fontSize: "0.82rem" }}
                                    />

                                    {/* Lead count badge */}
                                    {stage.leadCount > 0 && (
                                        <span style={{
                                            fontSize: "0.65rem",
                                            fontWeight: 700,
                                            color: "var(--text-muted)",
                                            background: "rgba(255,255,255,0.05)",
                                            padding: "2px 8px",
                                            borderRadius: "100px",
                                        }}>
                                            {stage.leadCount} leads
                                        </span>
                                    )}

                                    {/* Move up/down */}
                                    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                                        <button
                                            onClick={() => moveStage(idx, -1)}
                                            disabled={idx === 0}
                                            style={{
                                                background: "none", border: "none", padding: "2px",
                                                cursor: idx === 0 ? "default" : "pointer",
                                                color: idx === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                                                opacity: idx === 0 ? 0.3 : 1,
                                            }}
                                        >
                                            <ChevronUp size={14} />
                                        </button>
                                        <button
                                            onClick={() => moveStage(idx, 1)}
                                            disabled={idx === editableStages.length - 1}
                                            style={{
                                                background: "none", border: "none", padding: "2px",
                                                cursor: idx === editableStages.length - 1 ? "default" : "pointer",
                                                color: idx === editableStages.length - 1 ? "var(--text-muted)" : "var(--text-secondary)",
                                                opacity: idx === editableStages.length - 1 ? 0.3 : 1,
                                            }}
                                        >
                                            <ChevronDown size={14} />
                                        </button>
                                    </div>

                                    {/* Delete */}
                                    <button
                                        onClick={() => handleDeleteStage(idx)}
                                        title={stage.leadCount > 0 ? "Mueve los leads primero" : "Eliminar etapa"}
                                        style={{
                                            background: "none", border: "none", padding: "4px",
                                            cursor: stage.leadCount > 0 && !stage.isNew ? "not-allowed" : "pointer",
                                            color: stage.leadCount > 0 && !stage.isNew ? "var(--text-muted)" : "var(--danger)",
                                            opacity: stage.leadCount > 0 && !stage.isNew ? 0.3 : 0.7,
                                            transition: "opacity 0.2s",
                                        }}
                                        onMouseEnter={(e) => {
                                            if (!(stage.leadCount > 0 && !stage.isNew))
                                                (e.currentTarget as HTMLButtonElement).style.opacity = "1";
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!(stage.leadCount > 0 && !stage.isNew))
                                                (e.currentTarget as HTMLButtonElement).style.opacity = "0.7";
                                        }}
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            ))}

                            {/* Add new stage row */}
                            <div style={{
                                display: "flex",
                                gap: "10px",
                                alignItems: "center",
                                marginTop: "8px",
                                padding: "10px 14px",
                                borderRadius: "var(--radius)",
                                background: "rgba(124,58,237,0.06)",
                                border: "1px dashed rgba(124,58,237,0.2)",
                            }}>
                                <Plus size={16} style={{ color: "var(--accent-light)", flexShrink: 0 }} />
                                <input
                                    className="input"
                                    value={newStageName}
                                    onChange={(e) => setNewStageName(e.target.value)}
                                    placeholder="Nueva etapa..."
                                    onKeyDown={(e) => e.key === "Enter" && handleAddStage()}
                                    style={{ flex: 1, padding: "8px 12px", fontSize: "0.82rem" }}
                                />
                                <button
                                    className="btn-secondary"
                                    onClick={handleAddStage}
                                    disabled={!newStageName.trim()}
                                    style={{ padding: "8px 16px", fontSize: "0.8rem" }}
                                >
                                    Agregar
                                </button>
                            </div>
                        </div>

                        {/* Footer */}
                        <div className="modal-footer">
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => setShowConfig(false)}
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                className="btn-primary"
                                disabled={savingConfig}
                                onClick={handleSaveConfig}
                            >
                                {savingConfig ? (
                                    <><Loader2 size={15} className="animate-spin" /> Guardando…</>
                                ) : (
                                    <><Save size={16} /> Guardar Configuración</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
