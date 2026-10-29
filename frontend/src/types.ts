// Types copied exactly from ../backend/src/server.js responses. No invented fields.
// Anything the backend does not return is kept local (localStorage) and labelled
// as such in the UI — never presented as server data.

export const STATES = [
  'draft', 'issued', 'accepted', 'payment_pending', 'payment_confirmed',
  'preparing', 'delivered', 'completed', 'disputed', 'refund_pending',
  'refunded', 'cancelled',
] as const;
export type State = (typeof STATES)[number];

export const TRANSITIONS: Record<State, State[]> = {
  draft: ['issued', 'cancelled'],
  issued: ['accepted', 'cancelled'],
  accepted: ['payment_pending', 'cancelled'],
  payment_pending: ['payment_confirmed', 'cancelled'],
  payment_confirmed: ['preparing', 'cancelled'],
  preparing: ['delivered', 'disputed'],
  delivered: ['completed', 'disputed'],
  disputed: ['refund_pending', 'cancelled', 'preparing'],
  refund_pending: ['refunded'],
  completed: [], refunded: [], cancelled: [],
};

export const STATE_AR: Record<State, string> = {
  draft: 'مسودة',
  issued: 'صادر بانتظار القبول',
  accepted: 'مقبول من الطرفين',
  payment_pending: 'بانتظار تأكيد المؤسسة المالية',
  payment_confirmed: 'مؤكد مالياً بمرجع مؤسسة',
  preparing: 'قيد التجهيز',
  delivered: 'مسلّم بانتظار تأكيد الاستلام',
  completed: 'مكتمل ومغلق',
  disputed: 'نزاع مفتوح',
  refund_pending: 'استرداد بانتظار تنفيذ يدوي خارج النظام',
  refunded: 'مسترد',
  cancelled: 'ملغى',
};

export const ROLES = ['owner', 'ops_supervisor', 'ops_employee', 'financial_coordinator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_AR: Record<Role, string> = {
  owner: 'المالك',
  ops_supervisor: 'مشرف تشغيل',
  ops_employee: 'موظف تشغيل',
  financial_coordinator: 'منسّق مالي',
  viewer: 'مشاهد فقط',
};

export interface Contract {
  id: number; code: string; buyer_phone: string; seller_phone: string;
  product_description: string; amount: number; currency: string;
  delivery_point: string | null; state: State; clause_fingerprint: string;
  created_at: string; version?: number;
}
export interface Conversation { id: number; contract_id: number; party: string; status: string; unread_count: number; assigned_to?: string | null; }
export interface Message {
  id: number; conversation_id: number | null; direction: string;
  sender_name?: string; body: string; template_name: string | null;
  is_internal_note: boolean; created_at: string;
}
export interface Task {
  id: number; contract_id: number; title: string; type: string; status: string;
  financial_reference?: string;
}
export interface WorkflowStep { step_type: string; [key: string]: unknown; }
export interface Workflow {
  id: number; name: string; trigger_type: string; trigger_value: string | null;
  steps: WorkflowStep[]; is_active: boolean;
}
export interface Template {
  id: number; name: string; language: string; category: string; approval_status: string;
  // Meta status (Stage 5 contract). Absent on older backends / local-only rows.
  meta_status?: string; body?: string | null; buttons?: unknown; rejection_reason?: string | null;
  label_ar?: string; meta_template_id?: string | null;
  // Stage A full template fields (header text/media/document, footer, samples).
  header_type?: string | null; header_text?: string | null; header_link?: string | null;
  footer?: string | null; sample_values?: string[];
  // Computed by GET /api/whatsapp/templates/:id only (not on list rows).
  placeholders?: number[]; preview?: string; sendable?: boolean; send_block_reason?: string | null;
}
// Stage 5 Meta WhatsApp contract types (frontend/src/api.ts implements them).
// No token, secret, phone number, WABA ID, or other credential value is
// ever stored in these types — only booleans, counts, and statuses.
export type WizardStepStatus = 'done' | 'pending' | 'blocked';
export interface WhatsAppWizardStep { key: string; title_ar: string; status: WizardStepStatus; }
export interface WhatsAppStatusFull {
  health: boolean; webhook_verify_configured: boolean; webhook_hmac_configured: boolean;
  whatsapp_access_configured: boolean; phone_number_configured?: boolean; waba_configured?: boolean;
  api_version?: string; app_base_url?: string | null;
  templates_total: number; templates_approved: number;
  templates_meta_approved?: number; meta_configured?: boolean;
  embedded_signup?: { configured: boolean; app_id_configured: boolean; config_id_configured: boolean; app_secret_configured: boolean };
  wizard_steps?: WhatsAppWizardStep[];
}
export interface EmbeddedSignupConfig {
  embedded_configured: boolean; app_id_configured: boolean; config_id_configured: boolean;
  app_secret_configured: boolean; api_version?: string;
  launch?: { dialog_base: string; dialog_path: string; client_id: string; config_id: string; response_type: string; override_default_response_type: boolean; scope: string } | null;
}
export interface EmbeddedSignupCallbackResult {
  ok: boolean; tested?: boolean; persisted?: boolean; meta_user_id?: string | null;
  display_name?: string | null; waba_id?: string | null; phone_number_id?: string | null;
  configured?: Record<string, boolean>; message?: string; error?: string;
}
export interface WhatsAppTestTokenResult { ok: boolean; configured: boolean; meta_ok: boolean; dry_run?: boolean; error?: string; }
export interface WhatsAppSendResult { ok: boolean; dry_run?: boolean; message_id?: string; wamid?: string; error?: string; }
export interface WhatsAppTemplateSubmitResult { ok: boolean; dry_run?: boolean; meta_status?: string; template?: Template; error?: string; }
export interface WhatsAppTemplateSyncResult { ok: boolean; dry_run?: boolean; updated?: number; error?: string; }
export interface WhatsAppSendInput { to: string; body?: string; template_name?: string; language?: string; media?: unknown; }
export interface WhatsAppTemplateCreateInput { name: string; category: 'UTILITY'; language: 'ar'; body: string; buttons?: string[]; header_type?: string | null; header_text?: string | null; header_link?: string | null; footer?: string | null; sample_values?: string[]; }
export interface WhatsAppTemplateUpdateInput { label_ar?: string; header_type?: string | null; header_text?: string | null; header_link?: string | null; body?: string; footer?: string | null; buttons?: string[]; sample_values?: string[]; }
export interface User {
  id: number; full_name: string; email: string; role: Role; is_active: boolean;
  department?: string | null; sections?: string[]; actions?: Record<string, string[]>;
  is_primary_admin?: boolean; created_at?: string | null;
}
export type MeUser = User;
export interface Department { key: string; label_ar: string; }
export const DEPARTMENTS: { key: string; ar: string }[] = [
  { key: 'Operations', ar: 'العمليات' },
  { key: 'Finance Coordination', ar: 'التنسيق المالي' },
  { key: 'Customer Support', ar: 'دعم العملاء' },
  { key: 'Administration', ar: 'الإدارة' },
];
export const SECTIONS_AR: Record<string, string> = {
  dashboard: 'لوحة القيادة', contracts: 'العقود', inbox: 'الإنبكس', tasks: 'المهام',
  whatsapp: 'واتساب', automation: 'الأتمتة', users: 'المستخدمون', audit: 'التدقيق', settings: 'إعدادات النظام',
};
export const SECTIONS_LIST = ['dashboard', 'contracts', 'inbox', 'tasks', 'whatsapp', 'automation', 'users', 'audit', 'settings'];
export const ACTION_AR: Record<string, string> = {
  view: 'عرض', create: 'إنشاء', edit: 'تعديل', approve: 'اعتماد', manage: 'إدارة',
};
export const ACTIONS_LIST = ['view', 'create', 'edit', 'approve', 'manage'];
// Stage C contacts: contract-scoped address book. Roles, contracts,
// conversations, last_contact_at and utility eligibility are computed by the
// backend from existing contracts/conversations/messages — never invented
// here, and creating a contact never creates a contract or an audience.
export interface Contact {
  id: number; name: string; phone: string; labels: string[]; notes: string | null;
  created_at: string; roles: string[];
  contracts: { id: number; code: string; state: State; role: string }[];
  conversations: { id: number; contract_id: number | null; party: string; status: string; unread_count: number; last_inbound_at: string | null }[];
  last_contact_at: string | null; message_count: number;
  utility_eligible: boolean; eligibility_basis: 'prior_inbound' | 'approved_template' | null;
}
export interface ContactImportDetail { row: number; phone: string | null; status: 'created' | 'skipped' | 'error'; reason: string | null; }
export interface ContactImportReport {
  ok: boolean; total: number; created: number; skipped: number; errors: number;
  created_ids: number[]; details: ContactImportDetail[]; error_rows: ContactImportDetail[];
}
export interface AuditEntry {
  id: number; actor: string; entity: string; entity_id: number; action: string;
  details: Record<string, unknown>; created_at: string;
}

// Workflow step palette: every step type named in the brief, in order.
// The backend accepts any step_type except the forbidden money steps
// (release_money, refund_money, confirm_payment) — enforced server-side and
// blocked again in the editor. Triggers are separate: keyword / contract-event / manual.
export const STEP_TYPES = [
  { type: 'text', ar: 'رسالة نصية' },
  { type: 'template', ar: 'قالب واتساب' },
  { type: 'image', ar: 'صورة' },
  { type: 'video', ar: 'فيديو' },
  { type: 'audio', ar: 'رسالة صوتية' },
  { type: 'document', ar: 'مستند' },
  { type: 'buttons', ar: 'أزرار تفاعلية (حتى 3)' },
  { type: 'list', ar: 'قائمة اختيار (حتى 10)' },
  { type: 'question_text', ar: 'سؤال نص حر' },
  { type: 'question_number', ar: 'سؤال رقمي' },
  { type: 'media_request', ar: 'طلب وسائط من العميل' },
  { type: 'condition', ar: 'شرط / تفرّع' },
  { type: 'action', ar: 'إجراء تشغيلي (غير مالي)' },
  { type: 'delay', ar: 'انتظار / تأخير' },
  { type: 'handover', ar: 'تحويل لموظف بشري' },
  { type: 'end', ar: 'إنهاء التدفق' },
] as const;

export const TRIGGER_TYPES = [
  { type: 'keyword', ar: 'كلمة مفتاحية' },
  { type: 'first_message', ar: 'أول رسالة' },
  { type: 'button_reply', ar: 'رد زر/قائمة' },
  { type: 'contract-event', ar: 'حدث عقد' },
  { type: 'business_hours', ar: 'أثناء الدوام' },
  { type: 'away', ar: 'خارج الدوام' },
  { type: 'fallback', ar: 'احتياطي بعد رسالتين غير مفهومتين' },
  { type: 'manual', ar: 'تشغيل يدوي' },
] as const;

export const FORBIDDEN_STEP_TYPES = ['release_money', 'refund_money', 'confirm_payment'];

export const TEMPLATE_AR: Record<string, string> = {
  contract_created: 'تم إنشاء العقد',
  invite_accept: 'دعوة للقبول',
  contract_accepted: 'تم قبول العقد',
  payment_request: 'طلب دفع',
  payment_confirmed_fi: 'تأكيد دفع من المؤسسة المالية',
  preparing: 'الطلب قيد التجهيز',
  delivery_confirmed: 'تأكيد التسليم',
  transaction_closed: 'إغلاق المعاملة',
  dispute_opened: 'فتح نزاع',
  handover_support: 'تحويل للدعم البشري',
};

export const CHECKLIST: { title: string; detail: string }[] = [
  { title: 'حساب Meta Business وتوثيقه', detail: 'التحقق من الحساب التجاري في Meta قبل أي ربط.' },
  { title: 'رقم واتساب مخصص مرتبط بحساب WhatsApp Business', detail: 'رقم مخصص للخدمة، منفصل عن الرقم الشخصي.' },
  { title: 'اتفاق مع المؤسسة المالية الخارجية', detail: 'الأموال تُحفظ لدى المؤسسة فقط؛ لا محفظة داخلية ولا ربط بنكي آلي.' },
  { title: 'اعتماد القوالب العشرة في Meta', detail: 'قوالب Utility بالعربية؛ لا إرسال قبل اعتماد كل قالب.' },
  { title: 'إدخال بيانات الربط في متغيرات البيئة، وليس في المحادثة', detail: 'لا تُكتب أي مفاتيح أو رموز داخل هذه الواجهة أو أي ملف في المشروع.' },
  { title: 'ضبط Webhook والتحقق بتوقيع HMAC', detail: 'التحقق من التوقيع عند تفعيل WHATSAPP_APP_SECRET في الخادم.' },
  { title: 'اختبار رسالة حقيقية من رقم تجريبي', detail: 'رسالة واردة واحدة على الأقل من رقم اختبار قبل التشغيل.' },
  { title: 'اختبار دورة عقد كاملة', detail: 'من المسودة حتى الإغلاق، مروراً بتأكيد مالي بمرجع مؤسسة.' },
  { title: 'النسخ الاحتياطي والمراقبة', detail: 'نسخ احتياطي دوري لبيانات العقود وسجل التدقيق.' },
  { title: 'قبول العميل والتدريب', detail: 'تدريب فريق التشغيل على مفتاح الإيقاف والخطوات اليدوية.' },
];
