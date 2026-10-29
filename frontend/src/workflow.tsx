import { useEffect, useState } from 'react';
import { api, local } from './api';
import { Badge, Card, Empty, Field, LocalNote } from './components';
import { FLOW_NODE_KINDS, FORBIDDEN_STEP_TYPES, STEP_TYPES, TRIGGER_TYPES, type Template, type Workflow, type WorkflowStep } from './types';

type DraftStep = WorkflowStep & {
  content?: string; template_name?: string; media_url?: string; caption?: string;
  buttons?: string[]; items?: string[]; question?: string; condition_expr?: string;
  action_text?: string; delay_seconds?: number; handover_note?: string;
};

function blankStep(type: string): DraftStep {
  const s: DraftStep = { step_type: type };
  if (type === 'buttons') s.buttons = [''];
  if (type === 'list') s.items = [''];
  if (type === 'delay') s.delay_seconds = 60;
  return s;
}
function stepLabel(s: DraftStep): string {
  const t = STEP_TYPES.find((x) => x.type === s.step_type)?.ar || s.step_type;
  const extra = s.content || s.template_name || s.question || s.action_text || s.caption || '';
  return extra ? `${t}: ${String(extra).slice(0, 60)}` : t;
}

export function WorkflowDesigner({ workflows, templates, reload }: { workflows: Workflow[]; templates: Template[]; reload: () => void }) {
  const hidden = local.hiddenWorkflows();
  const visible = workflows.filter((w) => !hidden.includes(w.id));
  const [name, setName] = useState('');
  const [triggerType, setTriggerType] = useState('keyword');
  const [triggerValue, setTriggerValue] = useState('');
  const [steps, setSteps] = useState<DraftStep[]>([blankStep('text')]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState(false);
  const [sim, setSim] = useState(0);
  const [simAns, setSimAns] = useState<Record<number, string>>({});
  const [simDone, setSimDone] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);
  const [ks, setKs] = useState<boolean | null>(null);
  useEffect(() => { api.killSwitchGet().then((r) => setKs(r.killSwitch)).catch(() => setKs(null)); }, []);

  function loadIntoEditor(w: Workflow, copy: boolean) {
    setName(copy ? `نسخة من ${w.name}` : w.name);
    setTriggerType(w.trigger_type); setTriggerValue(w.trigger_value || '');
    setSteps((w.steps as DraftStep[]).length ? (w.steps as DraftStep[]) : [blankStep('text')]);
    setEditingId(copy ? null : w.id); setPreview(false); setSim(0); setSimDone(false);
    setMsg(copy ? 'تم تحميل نسخة — احفظها كتدفق جديد.' : 'تم تحميل التدفق للتعديل — الحفظ يحدّث التدفق نفسه في الخادم.');
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir; if (j < 0 || j >= steps.length) return;
    const next = [...steps]; [next[i], next[j]] = [next[j], next[i]]; setSteps(next);
  }
  function update(i: number, patch: Partial<DraftStep>) { const next = [...steps]; next[i] = { ...next[i], ...patch }; setSteps(next); }
  async function save() {
    if (!name.trim()) { setMsg('أدخل اسم التدفق.'); return; }
    if (steps.some((s) => FORBIDDEN_STEP_TYPES.includes(s.step_type))) { setMsg('خطوة مالية مرفوضة: لا يمكن حفظ تدفق يحمل خطوة مال.'); return; }
    try {
      if (editingId) {
        const w = await api.updateWorkflow(editingId, { name: name.trim(), trigger_type: triggerType, trigger_value: triggerValue || null, steps });
        setMsg(`تم تحديث التدفق «${w.name}» (رقم ${w.id}) في الخادم.`);
      } else {
        const w = await api.createWorkflow({ name: name.trim(), trigger_type: triggerType, trigger_value: triggerValue || null, steps });
        setMsg(`تم حفظ التدفق «${w.name}» (رقم ${w.id}).`);
      }
      setEditingId(null); reload();
    } catch (err) { setMsg('خطأ: ' + (err as Error).message); }
  }
  // Properties panel for ONE selected canvas node only. Unselected nodes
  // stay compact on the map; this panel is the only place a node is edited.
  function stepFields(s: DraftStep, i: number) {
    return <div className="grid2">
      <Field label="نوع العقدة"><select value={s.step_type} onChange={(e) => update(i, blankStep(e.target.value))}>{STEP_TYPES.map((t) => <option key={t.type} value={t.type}>{t.ar}</option>)}</select></Field>
      {['text', 'action'].includes(s.step_type) && <Field label={s.step_type === 'text' ? 'نص الرسالة' : 'وصف الإجراء التشغيلي (غير مالي)'}><input value={String(s.content || s.action_text || '')} onChange={(e) => update(i, s.step_type === 'text' ? { content: e.target.value } : { action_text: e.target.value })} /></Field>}
      {s.step_type === 'template' && <Field label="القالب"><select value={s.template_name || ''} onChange={(e) => update(i, { template_name: e.target.value })}><option value="">اختر قالباً</option>{templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}</select></Field>}
      {['image', 'video', 'audio', 'document'].includes(s.step_type) && <><Field label="رابط الوسائط"><input value={s.media_url || ''} onChange={(e) => update(i, { media_url: e.target.value })} placeholder="https://…" /></Field><Field label="تعليق"><input value={s.caption || ''} onChange={(e) => update(i, { caption: e.target.value })} /></Field></>}
      {s.step_type === 'buttons' && <Field label="الأزرار (حتى 3 — زر في كل سطر)"><textarea rows={3} value={(s.buttons || []).join('\n')} onChange={(e) => update(i, { buttons: e.target.value.split('\n').slice(0, 3) })} /></Field>}
      {s.step_type === 'list' && <Field label="عناصر القائمة (حتى 10 — عنصر في كل سطر)"><textarea rows={4} value={(s.items || []).join('\n')} onChange={(e) => update(i, { items: e.target.value.split('\n').slice(0, 10) })} /></Field>}
      {['question_text', 'question_number'].includes(s.step_type) && <Field label="نص السؤال"><input value={s.question || ''} onChange={(e) => update(i, { question: e.target.value })} /></Field>}
      {s.step_type === 'media_request' && <Field label="ما المطلوب من العميل؟"><input value={s.question || ''} onChange={(e) => update(i, { question: e.target.value })} placeholder="مثال: صورة المنتج قبل التغليف" /></Field>}
      {s.step_type === 'condition' && <Field label="الشرط (وصف نصي — مثال: إذا أجاب العميل نعم)"><input value={s.condition_expr || ''} onChange={(e) => update(i, { condition_expr: e.target.value })} /></Field>}
      {s.step_type === 'delay' && <Field label="مدة الانتظار (بالثواني)"><input type="number" min="0" value={s.delay_seconds ?? 60} onChange={(e) => update(i, { delay_seconds: Number(e.target.value) })} /></Field>}
      {s.step_type === 'handover' && <Field label="ملاحظة التحويل للموظف"><input value={s.handover_note || ''} onChange={(e) => update(i, { handover_note: e.target.value })} /></Field>}
      {s.step_type === 'end' && <p className="muted">ينهي التدفق هنا.</p>}
    </div>;
  }
  const nodeStepType: Record<string, string> = { message: 'text', template: 'template', condition: 'condition', wait: 'delay', handover: 'handover', end: 'end' };
  const cur = steps[sim];

  return <>
    <Card title="تدفقات واتساب" sub="الحفظ والتعديل والحذف يتم عبر الخادم نفسه (POST وPUT وDELETE على /api/workflows).">
      {visible.length === 0 ? <Empty text="لا تدفقات بعد." /> :
        <table><thead><tr><th>الاسم</th><th>المشغّل</th><th>القيمة</th><th>الخطوات</th><th>نشط</th><th></th></tr></thead>
        <tbody>{visible.map((w) => <tr key={w.id}><td>{w.name}</td><td>{TRIGGER_TYPES.find((t) => t.type === w.trigger_type)?.ar || w.trigger_type}</td><td>{w.trigger_value || '—'}</td><td>{w.steps.length}</td><td>{w.is_active ? 'نعم' : 'لا'}</td>
          <td><button className="btn small" onClick={() => loadIntoEditor(w, false)}>تعديل</button> <button className="btn small ghost" onClick={() => loadIntoEditor(w, true)}>نسخ</button> <button className="btn small ghost" onClick={async () => { try { await api.deleteWorkflow(w.id); setMsg(`تم حذف «${w.name}» من الخادم.`); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>حذف</button></td></tr>)}</tbody></table>}
    </Card>

    <Card title={editingId ? `تحرير تدفق (سيُحدَّث في الخادم)` : 'مصمّم تدفق جديد'}>
      <div className="grid2">
        <Field label="اسم التدفق"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: إنشاء عقد" /></Field>
        <Field label="نوع المشغّل"><select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>{TRIGGER_TYPES.map((t) => <option key={t.type} value={t.type}>{t.ar}</option>)}</select></Field>
        <Field label="قيمة المشغّل (كلمة مفتاحية / حدث عقد)"><input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} placeholder={triggerType === 'keyword' ? 'عقد جديد' : triggerType === 'contract-event' ? 'contract_accepted' : 'يدوي — اتركه فارغاً'} /></Field>
      </div>

      <h3>خريطة التدفق — انقر عقدة لتعديل خصائصها</h3>
      <p className="muted">عقد مسموحة فقط: بداية، رسالة، قالب، شرط، انتظار، تحويل لموظف، إنهاء. لا توجد عقدة دفع ولا إرسال جماعي ولا كتالوج ولا بيع ذكي — مرفوضة في هذا النظام أبداً، ولا تظهر في اللوحة.</p>
      <div className="flow-kill">
        <span>مفتاح إيقاف الأتمتة على الخريطة: {ks === null ? 'جارٍ القراءة…' : ks ? 'مُفعَّل — كل إرسال آلي موقوف الآن' : 'متوقف — الأتمتة تعمل'}</span>
        <button className="btn small ghost" onClick={async () => { try { const r = await api.killSwitchSet(!(ks || false)); setKs(r.killSwitch); reload(); } catch (err) { setMsg('خطأ: ' + (err as Error).message); } }}>{ks ? 'إعادة تشغيل الأتمتة' : 'إيقاف كل الأتمتة الآن'}</button>
      </div>
      <div className="flow-palette" aria-label="لوحة العقد">
        <span className="small">أضف عقدة:</span>
        {FLOW_NODE_KINDS.filter((n) => n.kind !== 'start').map((n) => <button key={n.kind} className="btn small ghost" onClick={() => { const st = blankStep(nodeStepType[n.kind]); setSteps([...steps, st]); setSelected(steps.length); }}>+ {n.ar}</button>)}
      </div>
      <div className="flow-canvas-wrap">
        <div className="flow-canvas" aria-label="خريطة التدفق">
          <div className="flow-node flow-start"><b>● بداية</b><span>{TRIGGER_TYPES.find((t) => t.type === triggerType)?.ar || triggerType}{triggerValue ? ` — ${triggerValue}` : ''}</span></div>
          {steps.map((st, i) => <div key={i}>
            <div className="flow-connector" aria-hidden="true">↓</div>
            <div className={`flow-node ${selected === i ? 'sel' : ''}`} draggable
              onClick={() => setSelected(i)}
              onDragStart={() => setDragIdx(i)} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragIdx === null || dragIdx === i) return; const next = [...steps]; const [m] = next.splice(dragIdx, 1); next.splice(i, 0, m); setSteps(next); setDragIdx(null); setSelected(i); }}>
              <span className="flow-node-num">{i + 1}</span>
              <span className="flow-node-body"><b>{stepLabel(st)}</b><span className="small">{STEP_TYPES.find((x) => x.type === st.step_type)?.ar || st.step_type}</span></span>
              <span className="flow-node-btns">
                <button onClick={(e) => { e.stopPropagation(); move(i, -1); }} title="للأعلى">↑</button>
                <button onClick={(e) => { e.stopPropagation(); move(i, 1); }} title="للأسفل">↓</button>
                <button onClick={(e) => { e.stopPropagation(); setSteps(steps.filter((_, j) => j !== i)); setSelected(Math.max(0, i - 1)); }} title="حذف العقدة">✕</button>
              </span>
            </div>
          </div>)}
          {steps.length === 0 && <p className="muted">أضف عقدة من اللوحة أعلاه لبدء الخريطة.</p>}
        </div>
        <aside className="flow-props">
          <h3>خصائص العقدة المحددة</h3>
          {steps.length === 0 ? <Empty text="لا عقد بعد — أضف عقدة من اللوحة." /> : steps[selected] ? <>{stepFields(steps[selected], selected)}<p className="small">اسحب العقدة من مقبضها أو استخدم ↑ ↓ لإعادة ترتيب الخريطة (بديل اللمس).</p></> : <Empty text="اختر عقدة من الخريطة." />}
        </aside>
      </div>
      <div className="btn-row">
        <button className="btn" onClick={save}>حفظ التدفق في الخادم</button>
        <button className="btn ghost" onClick={() => { setPreview(!preview); setSim(0); setSimDone(false); }}>{preview ? 'إخفاء المعاينة' : 'معاينة واتساب + محاكاة'}</button>
      </div>
      {msg && <p className="msg">{msg}</p>}

      {preview && <div className="preview-wrap">
        <div className="phone">
          <div className="phone-head">واتساب — معاينة التدفق</div>
          <div className="phone-body">
            {steps.map((s, i) => <div key={i} className="wa-bubble">
              {s.step_type === 'text' && <span>{s.content || '…رسالة نصية…'}</span>}
              {s.step_type === 'template' && <span>قالب: {s.template_name || '—'}</span>}
              {['image', 'video', 'audio', 'document'].includes(s.step_type) && <span>{s.step_type === 'image' ? 'صورة' : s.step_type === 'video' ? 'فيديو' : s.step_type === 'audio' ? 'صوتي' : 'مستند'} {s.caption || s.media_url || 'وسائط'}</span>}
              {s.step_type === 'buttons' && <span>{(s.buttons || []).filter(Boolean).map((b2, j) => <span key={j} className="wa-btn">{b2}</span>)}</span>}
              {s.step_type === 'list' && <span>{(s.items || []).filter(Boolean).map((it, j) => <div key={j}>• {it}</div>)}</span>}
              {['question_text', 'question_number', 'media_request'].includes(s.step_type) && <span>{s.question || 'سؤال للعميل'}</span>}
              {s.step_type === 'condition' && <span>شرط: {s.condition_expr || '—'}</span>}
              {s.step_type === 'action' && <span>إجراء: {s.action_text || '—'}</span>}
              {s.step_type === 'delay' && <span>انتظار {s.delay_seconds} ثانية</span>}
              {s.step_type === 'handover' && <span>تحويل لموظف: {s.handover_note || ''}</span>}
              {s.step_type === 'end' && <span>نهاية التدفق</span>}
            </div>)}
          </div>
        </div>
        <div className="sim">
          <h3>محاكاة بسيطة (لا ترسل شيئاً)</h3>
          {steps.length === 0 ? <Empty text="أضف خطوة أولاً." /> : simDone ? <>
            <p><Badge tone="ok">انتهت المحاكاة</Badge> — آخر إجاباتك: {Object.entries(simAns).map(([k, v]) => `#${Number(k) + 1}: ${v}`).join(' • ') || 'لا إجابات'}</p>
            <button className="btn ghost" onClick={() => { setSim(0); setSimDone(false); setSimAns({}); }}>إعادة المحاكاة</button>
          </> : cur ? <>
            <p><b>الخطوة {sim + 1} من {steps.length}:</b> {stepLabel(cur)}</p>
            {cur.step_type === 'condition' && <p className="muted">المحاكاة لا تنفّذ تفرّعاً حقيقياً — اضغط «التالي» للمتابعة الخطية، وسيُطبَّق الشرط الحقيقي عند الربط.</p>}
            {cur.step_type === 'delay' && <p className="muted">انتظار محاكى: {cur.delay_seconds} ثانية (لا انتظار فعلي في المحاكاة).</p>}
            {['question_text', 'media_request'].includes(cur.step_type) && <input value={simAns[sim] || ''} onChange={(e) => setSimAns({ ...simAns, [sim]: e.target.value })} placeholder="إجابتك هنا…" />}
            {cur.step_type === 'question_number' && <input type="number" value={simAns[sim] || ''} onChange={(e) => setSimAns({ ...simAns, [sim]: e.target.value })} placeholder="رقم…" />}
            {cur.step_type === 'buttons' && <div className="btn-row">{(cur.buttons || []).filter(Boolean).map((b2, j) => <button key={j} className="btn ghost" onClick={() => setSimAns({ ...simAns, [sim]: b2 })}>{b2}</button>)}</div>}
            {cur.step_type === 'list' && <div className="btn-row">{(cur.items || []).filter(Boolean).map((it, j) => <button key={j} className="btn ghost" onClick={() => setSimAns({ ...simAns, [sim]: it })}>{it}</button>)}</div>}
            <div className="btn-row">
              <button className="btn" onClick={() => { if (cur.step_type === 'end' || cur.step_type === 'handover' || sim === steps.length - 1) setSimDone(true); else setSim(sim + 1); }}>
                {cur.step_type === 'handover' ? 'إنهاء عند التحويل' : cur.step_type === 'end' ? 'إنهاء' : 'التالي'}
              </button>
              {sim > 0 && <button className="btn ghost" onClick={() => setSim(sim - 1)}>السابق</button>}
            </div>
          </> : null}
          <p className="muted">المحاكاة عرض فقط: لا ترسل رسائل واتساب ولا تنفّذ أي إجراء مالي.</p>
        </div>
      </div>}
    </Card>
  </>;
}
