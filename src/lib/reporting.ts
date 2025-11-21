import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client'; // en haut du fichier
import { PrismaService } from '../prisma/prisma.service';
import {
  AppointmentStatus,
  AppointmentType,
  BudgetPeriod,
  Role,
  LeadStage,
  CallOutcome,
} from '@prisma/client';
import PDFKit from 'pdfkit';
import { Parser as Json2Csv } from 'json2csv';

type Range = { from?: Date; to?: Date };
type RangeTz = { from?: string; to?: string; tz: string };
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
type RangeArgs = { from?: string; to?: string };


/* ---------------- Dates helpers (UTC) ---------------- */
function toUTCDateOnly(s?: string) {
  if (!s) return undefined;
  if (s.includes('T')) {
    const d = new Date(s);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
  }
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

// --------- Moteur PDF avancé (header, sections, table, footer) ---------
// --------- Moteur PDF avancé (header, sections, table, footer) ---------
async function buildAdvancedPDF(params: {
  title: string;
  period: string;
  columns: { key: string; header: string; width: number; align?: 'left'|'center'|'right'; format?:(v:any)=>string }[];
  rows: any[];
  analysisIntro: string;       // paragraphe global haut de page
  perRowNotes?: (r:any)=>string; // note par personne (sous-ligne)
}): Promise<Buffer> {
  return await new Promise<Buffer>((resolve) => {
    const doc = new PDFKit({ size: 'A4', margin: 24 }); // marges réduites pour densité
    const chunks: any[] = [];
    let pageIndex = 1; // 👈 compteur manuel de pages

    doc.on('data', (c)=> chunks.push(c));
    doc.on('end', ()=> resolve(Buffer.concat(chunks)));

    // Fond global
    doc.rect(0,0,doc.page.width, doc.page.height).fill(PALETTE.bg);

    // Header band (gradient-like by two rects)
    const bandH = 68;
    doc.save();
    doc.fillColor(PALETTE.surface).rect(0,0,doc.page.width, bandH).fill();
    doc.restore();

    // Title & period
    doc.fillColor(PALETTE.text).fontSize(16).font('Helvetica-Bold');
    doc.text(params.title, 24, 18, { width: doc.page.width - 48 });
    doc.fontSize(10).font('Helvetica').fillColor(PALETTE.muted);
    doc.text(params.period, { width: doc.page.width - 48 });

    // Top metrics bar (chips)
    const chipY = 44;
    doc.save();
    doc.roundedRect(24, chipY, doc.page.width-48, 16, 8).fill(PALETTE.card);
    doc.restore();

    // Section: Analyse & recommandations
    let y = 90;
    doc.fontSize(11).font('Helvetica-Bold').fillColor(PALETTE.text);
    doc.text('Analyse & recommandations', 24, y);
    y += 14;
    doc.fontSize(10).font('Helvetica').fillColor(PALETTE.text);
    y = wrap(doc, params.analysisIntro, 24, y, doc.page.width - 48);
    y += 10;

    // Divider
    doc.save();
    doc.moveTo(24, y).lineTo(doc.page.width-24, y).strokeColor(PALETTE.line).lineWidth(0.8).stroke();
    doc.restore();
    y += 10;

    // Table header (sticky aware)
    const startX = 24;
    const tableW = doc.page.width - 48;
    const headerH = 18;

    function renderTableHeader(yh: number) {
      doc.save();
      doc.roundedRect(startX, yh-2, tableW, headerH+6, 6).fill(PALETTE.surface);
      doc.restore();
      let x = startX + 8;
      params.columns.forEach((c) => {
        doc.fontSize(9).font('Helvetica-Bold').fillColor(PALETTE.text);
        doc.text(c.header, x, yh, { width: c.width-8, align: c.align || 'left' });
        x += c.width;
      });
      return yh + headerH + 8;
    }

    y = renderTableHeader(y);

    // Table rows
    const rowH = 16;
    params.rows.forEach((r, idx) => {
      const zebra = idx % 2 === 0 ? PALETTE.card : PALETTE.bg;
      // Height may grow if note wraps
      let rowHeight = rowH;

      // pre-calc formatted values
      const formatted = params.columns.map(c => {
        const raw = r[c.key];
        const val = (c.format ? c.format(raw) : raw) ?? '';
        return String(val);
      });

      // Compute note height if any
      const note = params.perRowNotes ? params.perRowNotes(r) : '';
      const noteLines = note ? doc.heightOfString(note, { width: tableW-16, align: 'left' }) : 0;
      const extraNote = note ? Math.max(12, noteLines + 4) : 0;
      rowHeight += extraNote;

      // Page break (keep header sticky)
      if (y + rowHeight + 32 > doc.page.height) {
        // footer current page
        renderFooter(doc, params, pageIndex);
        doc.addPage();
        pageIndex += 1; // 👈 incrémente le numéro de page

        // repaint background
        doc.rect(0,0,doc.page.width, doc.page.height).fill(PALETTE.bg);
        y = 24;
        y = renderTableHeader(y);
      }

      // Row background
      doc.save();
      doc.roundedRect(startX, y-2, tableW, rowHeight, 6).fill(zebra);
      doc.restore();

      // Cells
      let x = startX + 8;
      params.columns.forEach((c, i) => {
        doc.fontSize(9).font('Helvetica').fillColor(PALETTE.text);
        doc.text(formatted[i], x, y, { width: c.width-8, align: c.align || 'left' });
        x += c.width;
      });

      // Row note
      if (note) {
        doc.fontSize(8.5).font('Helvetica').fillColor(PALETTE.muted);
        y = wrap(doc, note, startX + 8, y + rowH - 2, tableW - 16) + 6;
      } else {
        y += rowH + 4;
      }
    });

    // Footer last page
    renderFooter(doc, params, pageIndex);

    // end
    doc.end();

    // Footer renderer
    function renderFooter(d: PDFKit.PDFDocument, p: typeof params, page: number) {
      const txt = `${p.title} — ${p.period}`;
      const pageStr = `Page ${page}`;
      const yy = d.page.height - 20;

      d.save();
      d.fontSize(8).font('Helvetica').fillColor(PALETTE.muted);
      d.text(txt, 24, yy, { width: (d.page.width/2)-24, align: 'left' });
      d.text(pageStr, d.page.width/2, yy, { width: (d.page.width/2)-24, align: 'right' });
      d.restore();
    }
  });
}


// --------- Notes / commentaires par personne ---------
function setterRowNote(r: any) {
  const leads = r.leadsReceived || 0;
  const rv1P = r.rv1PlannedOnHisLeads || 0;
  const rv1H = r.rv1HonoredOnHisLeads || 0;
  const rv1C = r.rv1CanceledOnHisLeads || 0;
  const cancel = pct(rv1C, Math.max(1, rv1P));
  const qual = pct(rv1P, Math.max(1, leads));
  const presence = pct(rv1H, Math.max(1, rv1P));

  const tips: string[] = [];
  if (leads >= 1 && qual < 25) tips.push(`Qualification faible (${qual}%) → revoir script d’amorce & timing TTFC.`);
  if (presence < 60 && rv1P >= 5) tips.push(`Présence RV1 basse (${presence}%) → rappels + handoff plus robuste.`);
  if (cancel >= 20) tips.push(`Annulations élevées (${cancel}%) → vérifier alignement promesse / cible.`);
  if (!tips.length) tips.push(`Bon niveau de rigueur. Continuer la standardisation des SOP.`);
  return `• ${tips.join(' ')}`
}

function closerRowNote(r: any) {
  const rv1P = r.rv1Planned || 0;
  const rv1H = r.rv1Honored || 0;
  const sales = r.salesClosed || 0;
  const cancel = pct(r.rv1Canceled || 0, Math.max(1, rv1P));
  const closing = pct(sales, Math.max(1, rv1H));

  const tips: string[] = [];
  if (rv1H >= 1 && closing < 25) tips.push(`Taux de closing bas (${closing}%) → travailler objections & preuve sociale.`);
  if (cancel >= 20) tips.push(`Annulations RV1 élevées (${cancel}%) → boucler avec setters sur la qualif.`);
  if (!tips.length) tips.push(`Performance solide. Augmenter le volume au-delà du médian.`);
  return `• ${tips.join(' ')}`
}

function toLocalDateISO(date: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { // en-CA => YYYY-MM-DD
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  // @ts-ignore: formatToParts exists
  const parts = fmt.formatToParts(date).reduce((acc: any, p: any) => (acc[p.type] = p.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`; // "YYYY-MM-DD"
}

// ---- helpers d’analyse (communs) ----

const startOfDayUTC = (s?: string) => (s ? toUTCDateOnly(s) : undefined);
function endOfDayUTC(s?: string) {
  if (!s) return undefined;
  const d0 = toUTCDateOnly(s)!;
  const d1 = new Date(d0.getTime());
  d1.setUTCHours(23, 59, 59, 999);
  return d1;
}
function toRange(from?: string, to?: string): Range {
  return { from: startOfDayUTC(from), to: endOfDayUTC(to) };
}

/** SQL filter window for a *local calendar day* in the given tz. */
function whereLocalDay(field: 'occurredAt'|'scheduledAt'|'createdAt'|'stageUpdatedAt', from?: string, to?: string, tz = 'Europe/Paris') {
  if (!from || !to) return Prisma.sql`TRUE`;
  // Compare on local calendar day, not UTC clock time
  return Prisma.sql`
    ( (${Prisma.raw(`"${field}"`)} AT TIME ZONE ${tz})::date BETWEEN ${from}::date AND ${to}::date )
  `;
}

/** Returns a list of YYYY-MM-DD strings between [from;to] (local calendar). */
function daysSpanLocal(from?: string, to?: string) {
  if (!from || !to) return [] as string[];
  const out: string[] = [];
  const d0 = new Date(from + 'T00:00:00'); // interpret as calendar date string
  const d1 = new Date(to + 'T00:00:00');
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${dd}`);
  }
  return out;
}

function between(
  field:
    | 'createdAt'
    | 'scheduledAt'
    | 'stageUpdatedAt'
    | 'occurredAt'
    | 'startedAt'
    | 'requestedAt',
  r: Range,
) {
  if (!r.from && !r.to) return {};
  return { [field]: { gte: r.from ?? undefined, lte: r.to ?? undefined } } as any;
}
function mondayOfUTC(d: Date) {
  const x = new Date(d);
  const w = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - w);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}
function sundayOfUTC(d: Date) {
  const m = mondayOfUTC(d);
  const s = new Date(m);
  s.setUTCDate(s.getUTCDate() + 6);
  s.setUTCHours(23, 59, 59, 999);
  return s;
}
function intersectWindow(aStart: Date, aEnd: Date, bStart?: Date, bEnd?: Date) {
  const s = new Date(Math.max(aStart.getTime(), (bStart ?? aStart).getTime()));
  const e = new Date(Math.min(aEnd.getTime(), (bEnd ?? aEnd).getTime()));
  return s > e ? null : { start: s, end: e };
}

function pct(num: number, den: number) {
  return den ? Math.round((num / den) * 100) : 0;
}

// Palette & tokens (look "OpenAI/Systems")
const PALETTE = {
  bg: '#0F1420',
  surface: '#121826',
  card: '#0D1522',
  text: '#E6E8EC',
  muted: '#AAB0BC',
  line: '#223047',
  acc1: '#8B5CF6', // violet
  acc2: '#22C55E', // vert
  acc3: '#38BDF8', // bleu
  warn: '#F59E0B', // amber
  danger: '#EF4444',
  success: '#10B981',
};

// Wrap text helper
function wrap(doc: PDFKit.PDFDocument, text: string, x: number, y: number, w: number, opts: PDFKit.Mixins.TextOptions = {}) {
  doc.text(text, x, y, { width: w, ...opts });
  return doc.y;
}

/* ---------------- Types sortie (alignés au front) ---------------- */
type SetterRow = {
  userId: string;
  name: string;
  email: string;


  // existants
  leadsReceived: number;
  rv0Count: number;
  rv1FromHisLeads: number; // RV1 honorés (via StageEvent) sur ses leads
  ttfcAvgMinutes: number | null;
  revenueFromHisLeads: number;
  spendShare: number | null;
  cpl: number | null;
  cpRv0: number | null;
  cpRv1: number | null;
  roas: number | null;


  rv1PlannedFromHisLeads: number;    // nb de RV1 planifiés sur ses leads
  rv1CanceledFromHisLeads: number;   // nb de RV1 annulés sur ses leads
  salesFromHisLeads: number;         // nb de ventes (WON) issues de ses leads
};


type CloserRow = {
  userId: string;
  name: string;
  email: string;


  // existants
  rv1Planned: number;
  rv1Honored: number;
  rv1NoShow: number;
  rv2Planned: number;
  rv2Honored: number;
  salesClosed: number;
  revenueTotal: number;
  roasPlanned: number | null;
  roasHonored: number | null;


  rv1Canceled: number;
  rv2Canceled: number;
  rv1CancelRate: number | null; // annulés / planifiés (RV1)
  rv2CancelRate: number | null; // annulés / planifiés (RV2)
};


type SpotlightSetterRow = {
  userId: string;
  name: string;
  email: string;


  // Demande utilisateur — Setters
  rv1PlannedOnHisLeads: number;     // RV1 planifiés (sur ses leads)
  rv1DoneOnHisLeads: number;        // RV1 Fait (honorés) sur ses leads (via StageEvent RV1_HONORED)
  rv1CanceledOnHisLeads: number;    // RV1 annulés (sur ses leads)
  rv1CancelRate: number | null;     // % d’annulation RV1 (annulés/planifiés)


  salesFromHisLeads: number;        // Ventes depuis ses leads (WON count)
  revenueFromHisLeads: number;      // CA depuis ses leads (sum saleValue)


  settingRate: number | null;       // Taux de setting = RV1 planifiés / Leads reçus


  // Contexte pour l’UI
  leadsReceived: number;
  ttfcAvgMinutes: number | null;
};


type SpotlightCloserRow = {
  userId: string;
  name: string;
  email: string;


  // Demande utilisateur — Closers
  rv1Planned: number;               // RV1 planifiés pour le closer
  rv1Honored: number;               // RV1 Fait pour le closer (via StageEvent RV1_HONORED)
  rv1Canceled: number;              // RV1 annulés pour le closer
  rv1CancelRate: number | null;     // % d’annulation RV1


  rv2Planned: number;               // RV2 planifiés
  rv2Canceled: number;              // RV2 annulés
  rv2CancelRate: number | null;     // % d’annulation RV2


  salesClosed: number;              // Ventes (WON) par le closer
  revenueTotal: number;             // CA total
  closingRate: number | null;       // Taux de closing = ventes / RV1 honorés
};


type LeadsReceivedOut = {
  total: number;
  byDay?: Array<{ day: string; count: number }>;
};
type SalesWeeklyItem = {
  weekStart: string;
  weekEnd: string;
  revenue: number;
  count: number;
};
type SummaryOut = {
  period: { from?: string; to?: string };
  totals: {
    leads: number;
    revenue: number;
    salesCount: number;
    spend: number;
    roas: number | null;
    settersCount: number;
    closersCount: number;
    rv1Honored: number;
  };
};
type WeeklyOpsRow = {
  weekStart: string;
  weekEnd: string;
  rv0Planned: number;
  rv0Honored: number;
  rv0NoShow?: number;
  rv1Planned: number;
  rv1Honored: number;
  rv1NoShow: number;
  rv1Postponed?: number;
  rv2Planned: number;
  rv2Honored: number;
  rv2NoShow: number;
  rv2Postponed?: number;
  notQualified?: number;
  lost?: number;
};


/* ---------- Funnel ---------- */
type FunnelTotals = {
  leads: number;
  callRequests: number;
  callsTotal: number;
  callsAnswered: number;
  setterNoShow: number;
  rv0Planned: number;
  rv0Honored: number;
  rv0NoShow: number;
  rv0Canceled: number;  
  rv1Planned: number;
  rv1Honored: number;
  rv1NoShow: number;
  rv1Canceled: number;  
  rv2Planned: number;
  rv2Honored: number;
  rv2NoShow: number;
  rv2Canceled: number;  
  notQualified: number;
  lost: number;
  wonCount: number;
  appointmentCanceled: number;
};
type FunnelWeeklyRow = { weekStart: string; weekEnd: string } & FunnelTotals;
type FunnelOut = {
  period: { from?: string; to?: string };
  totals: FunnelTotals;
  weekly: FunnelWeeklyRow[];
};


/* ---------- Duos (setter × closer) ---------- */
type DuoRow = {
  setterId: string;
  setterName: string;
  setterEmail: string;
  closerId: string;
  closerName: string;
  closerEmail: string;
  salesCount: number;
  revenue: number;
  avgDeal: number;
  rv1Planned: number;
  rv1Honored: number;
  rv1HonorRate: number | null;
};


@Injectable()
export class ReportingService {
  constructor(private readonly prisma: PrismaService) {}


  /** Helpers dates → borne inclusive [from 00:00:00, to 23:59:59] dans le TZ demandé */
  private dateSqlBounds(from?: string, to?: string, tz = 'Europe/Paris') {
    if (!from || !to) return { from, to, tz };
    return { from, to, tz };
  }


  /** Compte des StageEvent.
 * - stages: liste d'enums LeadStage (ex: [LeadStage.RV1_HONORED])
 * - r: fenêtre temps (occurredAt ∈ [from;to])
 * - by: filtre d'attribution (setterId/closerId/userId)
 * - distinctByLead: true → COUNT(DISTINCT se."leadId")
 */
private async countSE(args: {
  stages: LeadStage[];
  r: Range;
  by?: { setterId?: string; closerId?: string; userId?: string };
  distinctByLead?: boolean;
}): Promise<number> {
  const { stages, r, by, distinctByLead } = args;
  if (!stages?.length) return 0;


  const selectCount = distinctByLead
    ? Prisma.sql`COUNT(DISTINCT se."leadId")::int`
    : Prisma.sql`COUNT(*)::int`;


  const bySql: Prisma.Sql[] = [];
  if (by?.setterId) bySql.push(Prisma.sql`l."setterId" = ${by.setterId}`);
  if (by?.closerId) bySql.push(Prisma.sql`l."closerId" = ${by.closerId}`);
  if (by?.userId)   bySql.push(Prisma.sql`se."userId" = ${by.userId}`);


  // ATTENTION: le séparateur de Prisma.join doit être du SQL, pas une string
const whereBy =
    bySql.length ? Prisma.sql`AND ${Prisma.join(bySql, ' AND ')}` : Prisma.empty;
  const stageList = Prisma.join(stages.map(s => Prisma.sql`${s}::"LeadStage"`));
  const timeClause =
    r.from && r.to
      ? Prisma.sql`se."occurredAt" >= ${r.from} AND se."occurredAt" <= ${r.to}`
      : Prisma.sql`TRUE`;


  const rows = await this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT ${selectCount} AS n
    FROM "StageEvent" se
    JOIN "Lead" l ON l."id" = se."leadId"
    WHERE se."toStage" = ANY(ARRAY[${stageList}]::"LeadStage"[])
      AND ${timeClause}
      ${whereBy}
  `);
  return rows?.[0]?.n ?? 0;
}


  /** Agrège, par setter, le nombre DISTINCT de leads ayant eu un StageEvent dans [from;to]. */
private async countSEGroupedBySetterDistinct(args: {
  stages: LeadStage[];
  r: Range;
}): Promise<Map<string, number>> {
  const { stages, r } = args;
  if (!stages?.length) return new Map();


  const stageList = Prisma.join(stages.map(s => Prisma.sql`${s}::"LeadStage"`));
  const timeClause =
    r.from && r.to
      ? Prisma.sql`se."occurredAt" >= ${r.from} AND se."occurredAt" <= ${r.to}`
      : Prisma.sql`TRUE`;


  const rows = await this.prisma.$queryRaw<Array<{ setterId: string | null; n: number }>>(Prisma.sql`
    SELECT l."setterId" AS "setterId", COUNT(DISTINCT se."leadId")::int AS n
    FROM "StageEvent" se
    JOIN "Lead" l ON l."id" = se."leadId"
    WHERE se."toStage" = ANY(ARRAY[${stageList}]::"LeadStage"[])
      AND ${timeClause}
    GROUP BY l."setterId"
  `);


  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.setterId) out.set(row.setterId, row.n || 0);
  }
  return out;
}


  /* ---------------- Won (stages dynamiques gérés) ---------------- */
  private async wonStageIds(): Promise<string[]> {
    try {
      const rows = await this.prisma.stage.findMany({
        where: { isActive: true, isWon: true },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    } catch {
      return [];
    }
  }
  private async wonFilter(r: Range) {
    const wonIds = await this.wonStageIds();
    const base: any = wonIds.length
      ? { stageId: { in: wonIds } }
      : { stage: LeadStage.WON as any };
    if (!r.from && !r.to) return base;
    return { AND: [base, between('stageUpdatedAt', r)] } as any;
  }


// ---- CSV ----
async exportSpotlightSettersCSV({ from, to }: RangeArgs): Promise<Buffer> {
  const rows = await this.spotlightSetters(from, to); // ← tes données existantes
  const csv = new Json2Csv({
    fields: [
      { label: 'Setter', value: 'name' },
      { label: 'Email', value: 'email' },
      { label: 'Leads reçus', value: (r:any)=> r.leadsReceived||0 },
      { label: 'RV1 planifiés (ses leads)', value: (r:any)=> r.rv1PlannedOnHisLeads||0 },
      { label: 'RV1 honorés (ses leads)', value: (r:any)=> r.rv1HonoredOnHisLeads||0 },
      { label: 'RV1 annulés (ses leads)', value: (r:any)=> r.rv1CanceledOnHisLeads||0 },
      { label: '% annulation RV1', value: (r:any)=> pct(r.rv1CanceledOnHisLeads||0, r.rv1PlannedOnHisLeads||0) + '%' },
      { label: 'Ventes (depuis ses leads)', value: (r:any)=> r.salesFromHisLeads||0 },
      { label: 'CA (depuis ses leads)', value: (r:any)=> r.revenueFromHisLeads||0 },
      { label: 'TTFC (min)', value: (r:any)=> r.ttfcAvgMinutes ?? '' },
      { label: 'Taux de setting', value: (r:any)=> r.settingRate!=null ? Math.round(r.settingRate*100)+'%' : '' },
    ]
  }).parse(rows || []);
  return Buffer.from(csv, 'utf8');
}

async exportSpotlightClosersCSV({ from, to }: RangeArgs): Promise<Buffer> {
  const rows = await this.spotlightClosers(from, to);
  const csv = new Json2Csv({
    fields: [
      { label: 'Closer', value: 'name' },
      { label: 'Email', value: 'email' },
      { label: 'RV1 planifiés', value: (r:any)=> r.rv1Planned||0 },
      { label: 'RV1 honorés', value: (r:any)=> r.rv1Honored||0 },
      { label: 'RV1 annulés', value: (r:any)=> r.rv1Canceled||0 },
      { label: '% annulation RV1', value: (r:any)=> pct(r.rv1Canceled||0, r.rv1Planned||0)+'%' },
      { label: 'RV2 planifiés', value: (r:any)=> r.rv2Planned||0 },
      { label: 'RV2 honorés', value: (r:any)=> r.rv2Honored||0 },
      { label: 'RV2 annulés', value: (r:any)=> r.rv2Canceled||0 },
      { label: '% annulation RV2', value: (r:any)=> pct(r.rv2Canceled||0, r.rv2Planned||0)+'%' },
      { label: 'Ventes', value: (r:any)=> r.salesClosed||0 },
      { label: 'CA', value: (r:any)=> r.revenueTotal||0 },
      { label: 'Taux closing', value: (r:any)=> r.closingRate!=null ? Math.round(r.closingRate*100)+'%' : '' },
    ]
  }).parse(rows || []);
  return Buffer.from(csv, 'utf8');
}


// ---- PDF (PDFKit) ----
// ---- PDF (PDFKit) ----
private async buildSpotlightPDF(
  title: string,
  period: string,
  rows: any[],
  columns: { key: string; header: string; width?: number; format?:(v:any)=>string }[],
  analysis: string,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve) => {
    const doc = new PDFKit({ size: 'A4', margin: 36 });
    const chunks: any[] = [];
    doc.on('data', (c)=> chunks.push(c));
    doc.on('end', ()=> resolve(Buffer.concat(chunks)));

    // header
    doc.fontSize(16).fillColor('#111').text(title, { underline: false });
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor('#666').text(period);
    doc.moveDown(0.6);

    // analysis
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text('Analyse & recommandations');
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#222').text(analysis, { align: 'left' });
    doc.moveDown(0.8);

    // table header
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text('Tableau de performances');
    doc.moveDown(0.3);

    const startX = doc.x;
    const startY = doc.y;
    const colX: number[] = [];
    let x = startX;

    columns.forEach((c) => {
      const w = c.width ?? 120;
      colX.push(x);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text(c.header, x, startY, { width: w });
      x += w + 8;
    });

    doc.moveTo(startX, startY + 14).lineTo(x-8, startY + 14).strokeColor('#ddd').stroke();
    doc.moveDown(0.2);

    // table rows
    let y = startY + 18;
    rows.forEach((r:any) => {
      x = startX;
      columns.forEach((c) => {
        const w = c.width ?? 120;
        const raw = r[c.key];
        const val = c.format ? c.format(raw) : (raw ?? '');
        doc.fontSize(9).font('Helvetica').fillColor('#000').text(String(val), x, y, { width: w });
        x += w + 8;
      });
      y += 14;
      if (y > 780) {
        doc.addPage();
        y = 48;
      }
    });

    doc.end();
  });
}


private buildSetterAnalysis(rows: any[]) {
  if (!rows?.length) return "Aucune donnée disponible sur la période.";
  const totalLeads = rows.reduce((s,r)=> s + (Number(r.leadsReceived)||0), 0);
  const totalPlanned = rows.reduce((s,r)=> s + (Number(r.rv1PlannedOnHisLeads)||0), 0);
  const totalHonored = rows.reduce((s,r)=> s + (Number(r.rv1HonoredOnHisLeads)||0), 0);
  const totalCanceled = rows.reduce((s,r)=> s + (Number(r.rv1CanceledOnHisLeads)||0), 0);
  const qualRate = pct(totalPlanned, totalLeads);
  const honorRate = pct(totalHonored, totalPlanned);
  const cancelRate = pct(totalCanceled, totalPlanned);

  const topByPlanned = [...rows].sort((a,b)=>(b.rv1PlannedOnHisLeads||0)-(a.rv1PlannedOnHisLeads||0))[0];
  const worstCancel = [...rows]
    .map(r => ({...r, cancelRate: pct(r.rv1CanceledOnHisLeads||0, r.rv1PlannedOnHisLeads||0)}))
    .sort((a,b)=>(b.cancelRate-a.cancelRate))[0];

  return [
    `Sur la période : ${totalLeads} leads, ${totalPlanned} RV1 planifiés, ${totalHonored} honorés.`,
    `Taux de qualification : ${qualRate}%. Taux de présence RV1 : ${honorRate}%. Taux d’annulation RV1 : ${cancelRate}%.`,
    topByPlanned ? `Meilleur volume de RV1 : ${topByPlanned.name} (${topByPlanned.rv1PlannedOnHisLeads || 0}).` : '',
    worstCancel ? `Plus fort taux d’annulation : ${worstCancel.name} (${worstCancel.cancelRate}%).` : '',
    `Recommandations :`,
    `• Renforcer le suivi des leads à faible TTFC (accélérer le 1er contact) ;`,
    `• Analyser les sources des annulations (calendrier, qualification, objections) ;`,
    `• Capitaliser sur les setters à fort volume pour partager scripts et SOP.`,
  ].filter(Boolean).join('\n');
}

private buildCloserAnalysis(rows: any[]) {
  if (!rows?.length) return "Aucune donnée disponible sur la période.";
  const totalRv1P = rows.reduce((s,r)=> s + (Number(r.rv1Planned)||0), 0);
  const totalRv1H = rows.reduce((s,r)=> s + (Number(r.rv1Honored)||0), 0);
  const totalSales = rows.reduce((s,r)=> s + (Number(r.salesClosed)||0), 0);
  const totalRv1C = rows.reduce((s,r)=> s + (Number(r.rv1Canceled)||0), 0);
  const closingRate = pct(totalSales, totalRv1H);
  const cancelRate = pct(totalRv1C, totalRv1P);

  const topCloser = [...rows].sort((a,b)=>(b.salesClosed||0)-(a.salesClosed||0))[0];
  const bestPresence = [...rows]
    .map(r => ({...r, presence: pct(r.rv1Honored||0, r.rv1Planned||0)}))
    .sort((a,b)=>(b.presence-a.presence))[0];

  return [
    `Sur la période : ${totalRv1P} RV1 planifiés, ${totalRv1H} honorés, ${totalSales} ventes.`,
    `Taux de closing global : ${closingRate}%. Taux d’annulation RV1 : ${cancelRate}%.`,
    topCloser ? `Top ventes : ${topCloser.name} (${topCloser.salesClosed} ventes).` : '',
    bestPresence ? `Meilleure présence RV1 : ${bestPresence.name} (${bestPresence.presence}%).` : '',
    `Recommandations :`,
    `• Revoir les no-shows/annulations avec les setters (handoff & reminder) ;`,
    `• Outiller les objections récurrentes (cheatsheets) ;`,
    `• Allouer plus de volume aux closers > closing médian.`,
  ].filter(Boolean).join('\n');
}

// ==================== EXPORTS PDF AVANCÉS ====================
async exportSpotlightSettersPDF({ from, to }: { from?: string; to?: string }): Promise<Buffer> {
  const rows = await this.spotlightSetters(from, to) || [];

  // Agrégats pour l'intro d’analyse
  const totalLeads = rows.reduce((s: number,r:any)=> s + (Number(r.leadsReceived)||0), 0);
  const totalP = rows.reduce((s:number,r:any)=> s + (Number(r.rv1PlannedOnHisLeads)||0), 0);
  const totalH = rows.reduce((s:number,r:any)=> s + (Number(r.rv1HonoredOnHisLeads)||0), 0);
  const totalC = rows.reduce((s:number,r:any)=> s + (Number(r.rv1CanceledOnHisLeads)||0), 0);
  const qualRate = pct(totalP, Math.max(1,totalLeads));
  const presence = pct(totalH, Math.max(1,totalP));
  const cancel = pct(totalC, Math.max(1,totalP));

  const topVol = [...rows].sort((a,b)=>(b.rv1PlannedOnHisLeads||0)-(a.rv1PlannedOnHisLeads||0))[0];
  const worstCancel = [...rows]
    .map(r=>({...r, rate: pct(r.rv1CanceledOnHisLeads||0, Math.max(1,r.rv1PlannedOnHisLeads||0))}))
    .sort((a,b)=> b.rate - a.rate)[0];

  const analysisIntro = [
    `Sur la période, ${totalLeads} leads enregistrés → ${totalP} RV1 planifiés → ${totalH} honorés.`,
    `KPI globaux : qualification ${qualRate}%, présence RV1 ${presence}%, annulations ${cancel}%.`,
    topVol ? `Plus fort volume : ${topVol.name} (${topVol.rv1PlannedOnHisLeads||0} RV1 planifiés).` : '',
    worstCancel ? `Annulations les plus élevées : ${worstCancel.name} (${worstCancel.rate}%).` : '',
    `Focus actions : accélérer TTFC, calibrer la promesse amont, partager les scripts des meilleurs setters.`,
  ].filter(Boolean).join(' ');

  const columns = [
    { key: 'name', header: 'Setter', width: 140 },
    { key: 'leadsReceived', header: 'Leads', width: 55, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv1PlannedOnHisLeads', header: 'RV1 planifiés', width: 80, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv1HonoredOnHisLeads', header: 'RV1 honorés', width: 78, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv1CanceledOnHisLeads', header: 'RV1 annulés', width: 78, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv1CancelRateOnHisLeads', header: '% annul', width: 55, align:'right', format:(v:any)=> (v!=null? Math.round(v*100):0)+'%' },
    { key: 'salesFromHisLeads', header: 'Ventes', width: 55, align:'right', format:(v:any)=> String(v||0) },
    { key: 'revenueFromHisLeads', header: 'CA (€)', width: 70, align:'right', format:(v:any)=> Math.round(v||0).toLocaleString('fr-FR') },
    { key: 'ttfcAvgMinutes', header: 'TTFC (min)', width: 70, align:'right', format:(v:any)=> v==null?'—':String(v) },
    { key: 'settingRate', header: 'T. setting', width: 70, align:'right', format:(v:any)=> v!=null ? Math.round(v*100)+'%' : '—' },
  ] as const;

  return buildAdvancedPDF({
    title: 'Spotlight Setters',
    period: `Période : ${from || '—'} → ${to || '—'}`,
    columns: columns as any,
    rows,
    analysisIntro,
    perRowNotes: setterRowNote,
  });
}

async exportSpotlightClosersPDF({ from, to }: { from?: string; to?: string }): Promise<Buffer> {
  const rows = await this.spotlightClosers(from, to) || [];

  const totalP = rows.reduce((s:number,r:any)=> s + (Number(r.rv1Planned)||0), 0);
  const totalH = rows.reduce((s:number,r:any)=> s + (Number(r.rv1Honored)||0), 0);
  const totalSales = rows.reduce((s:number,r:any)=> s + (Number(r.salesClosed)||0), 0);
  const totalCancel = rows.reduce((s:number,r:any)=> s + (Number(r.rv1Canceled)||0), 0);
  const closing = pct(totalSales, Math.max(1,totalH));
  const cancel = pct(totalCancel, Math.max(1,totalP));

  const topSales = [...rows].sort((a,b)=>(b.salesClosed||0)-(a.salesClosed||0))[0];
  const bestPresence = [...rows]
    .map(r=> ({...r, presence: pct(r.rv1Honored||0, Math.max(1,r.rv1Planned||0))}))
    .sort((a,b)=> b.presence - a.presence)[0];

  const analysisIntro = [
    `Sur la période : ${totalP} RV1 planifiés → ${totalH} honorés → ${totalSales} ventes.`,
    `KPI globaux : closing ${closing}%, annulations RV1 ${cancel}%.`,
    topSales ? `Top ventes : ${topSales.name} (${topSales.salesClosed} ventes).` : '',
    bestPresence ? `Meilleure présence RV1 : ${bestPresence.name} (${bestPresence.presence}%).` : '',
    `Focus actions : co-résolution des objections récurrentes, re-qualification amont, allocation de volume aux closers > médian.`,
  ].filter(Boolean).join(' ');

  const columns = [
    { key: 'name', header: 'Closer', width: 150 },
    { key: 'rv1Planned', header: 'RV1 planifiés', width: 80, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv1Honored', header: 'RV1 honorés', width: 78, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv1Canceled', header: 'RV1 annulés', width: 78, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv1CancelRate', header: '% annul RV1', width: 70, align:'right', format:(v:any)=> v!=null ? Math.round(v*100)+'%' : '—' },
    { key: 'rv2Planned', header: 'RV2 planifiés', width: 78, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv2Honored', header: 'RV2 honorés', width: 78, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv2Canceled', header: 'RV2 annulés', width: 78, align:'right', format:(v:any)=> String(v||0) },
    { key: 'rv2CancelRate', header: '% annul RV2', width: 70, align:'right', format:(v:any)=> v!=null ? Math.round(v*100)+'%' : '—' },
    { key: 'salesClosed', header: 'Ventes', width: 55, align:'right', format:(v:any)=> String(v||0) },
    { key: 'revenueTotal', header: 'CA (€)', width: 70, align:'right', format:(v:any)=> Math.round(v||0).toLocaleString('fr-FR') },
    { key: 'closingRate', header: 'T. closing', width: 65, align:'right', format:(v:any)=> v!=null ? Math.round(v*100)+'%' : '—' },
  ] as const;

  return buildAdvancedPDF({
    title: 'Spotlight Closers',
    period: `Période : ${from || '—'} → ${to || '—'}`,
    columns: columns as any,
    rows,
    analysisIntro,
    perRowNotes: closerRowNote,
  });
}

  /* ---------------- Budgets ---------------- */
  private async sumSpend(r: Range): Promise<number> {
    const budgets = await this.prisma.budget.findMany({
      where: { period: BudgetPeriod.WEEKLY },
    });
    if (!r.from && !r.to) {
      return budgets.reduce((s, b) => s + num(b.amount), 0);
    }
    let sum = 0;
    for (const b of budgets) {
      if (!b.weekStart) continue;
      const ws = mondayOfUTC(new Date(b.weekStart));
      const we = sundayOfUTC(new Date(b.weekStart));
      if ((r.from ? ws <= r.to! : true) && (r.to ? we >= r.from! : true)) {
        sum += num(b.amount);
      }
    }
    return sum;
  }


  /* ---------------- Leads reçus (créations) ---------------- */
  async leadsReceived(from?: string, to?: string): Promise<LeadsReceivedOut> {
    const r = toRange(from, to);
    const total = await this.prisma.lead.count({ where: between('createdAt', r) });


    const days: Array<{ day: string; count: number }> = [];
    if (r.from && r.to) {
      const start = new Date(r.from);
      const end = new Date(r.to);
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const d0 = new Date(d);
        d0.setUTCHours(0, 0, 0, 0);
        const d1 = new Date(d);
        d1.setUTCHours(23, 59, 59, 999);
        const count = await this.prisma.lead.count({
          where: { createdAt: { gte: d0, lte: d1 } },
        });
        days.push({ day: d0.toISOString(), count: num(count) });
      }
    }
    return { total: num(total), byDay: days.length ? days : undefined };
  }


  /* ---------------- Ventes (WON) + hebdo ---------------- */
  async salesWeekly(from?: string, to?: string): Promise<SalesWeeklyItem[]> {
    const r = toRange(from, to);
    const start = mondayOfUTC(r.from ?? new Date());
    const end = sundayOfUTC(r.to ?? new Date());
    const out: SalesWeeklyItem[] = [];
    for (let w = new Date(start); w <= end; w.setUTCDate(w.getUTCDate() + 7)) {
      const ws = mondayOfUTC(w);
      const we = sundayOfUTC(w);
      const where = await this.wonFilter({ from: ws, to: we });
      const agg = await this.prisma.lead.aggregate({
        _sum: { saleValue: true },
        _count: { _all: true },
        where,
      });
      out.push({
        weekStart: ws.toISOString(),
        weekEnd: we.toISOString(),
        revenue: num(agg._sum.saleValue ?? 0),
        count: num(agg._count._all ?? 0),
      });
    }
    return out;
  }


  /** TTFC par SETTER = délai (minutes) entre 1ère CallRequest (dans [from;to])
 *  et 1er CallAttempt (>= request) réalisé par un utilisateur role=SETTER.
 *  Retourne un Map setterId -> { avg, n }.
 */
private async ttfcBySetter(from?: string, to?: string): Promise<Map<string, { avg: number; n: number }>> {
  const r = toRange(from, to);
  if (!r.from || !r.to) return new Map();


  // SQL Postgres: 1) first_req = première CallRequest par lead dans la fenêtre
  //               2) first_attempt = premier CallAttempt (setter) >= requestedAt
  //               3) on calcule le delta minutes et on agrège par setter (userId)
  const rows = await this.prisma.$queryRaw<Array<{ setterId: string; avg: number; n: number }>>(Prisma.sql`
    WITH first_req AS (
      SELECT DISTINCT ON (cr."leadId")
             cr."leadId",
             cr."requestedAt"
      FROM "CallRequest" cr
      WHERE cr."requestedAt" >= ${r.from!} AND cr."requestedAt" <= ${r.to!}
      ORDER BY cr."leadId", cr."requestedAt" ASC
    ),
    first_attempt AS (
      SELECT DISTINCT ON (ca."leadId")
             ca."leadId",
             ca."userId"     AS "setterId",
             ca."startedAt"  AS "attemptAt",
             fr."requestedAt" AS "requestedAt"
      FROM first_req fr
      JOIN "CallAttempt" ca
        ON ca."leadId" = fr."leadId" AND ca."startedAt" >= fr."requestedAt"
      JOIN "User" u
        ON u."id" = ca."userId" AND u."role" = 'SETTER' AND u."isActive" = TRUE
      ORDER BY ca."leadId", ca."startedAt" ASC
    )
    SELECT
      fa."setterId"                           AS "setterId",
      AVG(EXTRACT(EPOCH FROM (fa."attemptAt" - fa."requestedAt")) / 60.0)::numeric(10,2) AS avg,
      COUNT(*)::int                           AS n
    FROM first_attempt fa
    WHERE fa."attemptAt" >= fa."requestedAt"
    GROUP BY fa."setterId"
  `);


  const map = new Map<string, { avg: number; n: number }>();
  for (const r0 of rows) {
    map.set(r0.setterId, { avg: Number(r0.avg), n: r0.n });
  }
  return map;
}


/** TTFC par SETTER (minutes) via StageEvent:
 *  - point A = 1ère entrée dans CALL_REQUESTED du lead (dans [from;to])
 *  - point B = 1ère entrée dans CALL_ATTEMPT du lead, postérieure à A
 *  - attribution = setter actuel de la fiche (Lead.setterId)
 *  Renvoie Map<setterId, { avg, n }>.
 */
private async ttfcBySetterViaStages(from?: string, to?: string): Promise<Map<string, { avg: number; n: number }>> {
  const r = toRange(from, to);
  if (!r.from || !r.to) return new Map();


  const rows = await this.prisma.$queryRaw<Array<{ setterId: string; avg: number; n: number }>>(Prisma.sql`
    WITH first_req AS (
      SELECT DISTINCT ON (se."leadId")
             se."leadId",
             se."occurredAt" AS "requestedAt"
      FROM "StageEvent" se
      WHERE se."toStage" = ${Prisma.sql`'CALL_REQUESTED'::"LeadStage"`}
        AND se."occurredAt" >= ${r.from!}
        AND se."occurredAt" <= ${r.to!}
      ORDER BY se."leadId", se."occurredAt" ASC
    ),
    first_attempt AS (
      SELECT DISTINCT ON (se."leadId")
             se."leadId",
             se."occurredAt" AS "attemptAt"
      FROM "StageEvent" se
      JOIN first_req fr ON fr."leadId" = se."leadId"
      WHERE se."toStage" = ${Prisma.sql`'CALL_ATTEMPT'::"LeadStage"`}
        AND se."occurredAt" >= fr."requestedAt"
      ORDER BY se."leadId", se."occurredAt" ASC
    )
    SELECT
      l."setterId" AS "setterId",
      AVG(EXTRACT(EPOCH FROM (fa."attemptAt" - fr."requestedAt")) / 60.0)::numeric(10,2) AS avg,
      COUNT(*)::int AS n
    FROM first_req fr
    JOIN first_attempt fa ON fa."leadId" = fr."leadId"
    JOIN "Lead" l ON l."id" = fr."leadId"
    WHERE fa."attemptAt" >= fr."requestedAt" AND l."setterId" IS NOT NULL
    GROUP BY l."setterId"
  `);


  const map = new Map<string, { avg: number; n: number }>();
  for (const r0 of rows) map.set(r0.setterId, { avg: Number(r0.avg), n: r0.n });
  return map;
}


  /* ---------------- Setters (TTFC + RV1 via StageEvent) ---------------- */
  async settersReport(from?: string, to?: string): Promise<SetterRow[]> {
  const r = toRange(from, to);
  const spend = await this.sumSpend(r);


  // 1) Setters actifs
  const setters = await this.prisma.user.findMany({
    where: { role: Role.SETTER, isActive: true },
    select: { id: true, firstName: true, email: true },
    orderBy: { firstName: 'asc' },
  });


  // 2) Tous les leads créés (pour leadsReceived + répartition budget)
  const allLeads = await this.prisma.lead.findMany({
    where: between('createdAt', r),
    select: { id: true, setterId: true, createdAt: true },
  });
  const totalLeads = allLeads.length;


  // 👉 Nouveau : TTFC par setter, selon ta définition (CALL_REQUESTED -> CALL_ATTEMPT par SETTER)
  const ttfcMap = await this.ttfcBySetterViaStages(from, to);


  const rows: SetterRow[] = [];
  for (const s of setters) {
    const leads = allLeads.filter((l) => l.setterId === s.id);
    const leadsReceived = leads.length;


    // RV1 planned / canceled / honored DISTINCT par lead (via StageEvent)
    const [rv1PlannedFromHisLeads, rv1CanceledFromHisLeads, rv1FromHisLeads] = await Promise.all([
      this.countSE({ stages: [LeadStage.RV1_PLANNED],  r, by: { setterId: s.id }, distinctByLead: true }),
      this.countSE({ stages: [LeadStage.RV1_CANCELED], r, by: { setterId: s.id }, distinctByLead: true }),
      this.countSE({ stages: [LeadStage.RV1_HONORED],  r, by: { setterId: s.id }, distinctByLead: true }),
    ]);


    // RV0 réalisés par le setter (rdv tenus)
    const rv0Count = await this.prisma.appointment.count({
      where: { userId: s.id, type: AppointmentType.RV0, ...between('scheduledAt', r) },
    });


    // 👉 TTFC moyen (minutes) lu depuis la map (arrondi entier)
    const ttfcAgg = ttfcMap.get(s.id);
    const ttfcAvgMinutes = ttfcAgg ? Math.round(ttfcAgg.avg) : null;


    // Revenus & ventes (WON) sur ses leads, même critère WON que partout
    const wonWhere: any = await this.wonFilter(r);
    wonWhere.setterId = s.id;


    const [wonAgg, salesFromHisLeads] = await Promise.all([
      this.prisma.lead.aggregate({ _sum: { saleValue: true }, where: wonWhere }),
      this.prisma.lead.count({ where: wonWhere }),
    ]);
    const revenueFromHisLeads = num(wonAgg._sum?.saleValue ?? 0);


    // Répartition budget + coûts dérivés
    const spendShare =
      totalLeads && leadsReceived
        ? spend * (leadsReceived / totalLeads)
        : leadsReceived
        ? spend
        : 0;


    const cpl   = leadsReceived        ? Number((spendShare / leadsReceived).toFixed(2))        : null;
    const cpRv0 = rv0Count             ? Number((spendShare / rv0Count).toFixed(2))             : null;
    const cpRv1 = rv1FromHisLeads      ? Number((spendShare / rv1FromHisLeads).toFixed(2))      : null;
    const roas  = spendShare
      ? Number((revenueFromHisLeads / spendShare).toFixed(2))
      : revenueFromHisLeads
      ? Infinity
      : null;


    rows.push({
      userId: s.id,
      name: s.firstName,
      email: s.email,


      leadsReceived: num(leadsReceived),
      rv0Count: num(rv0Count),


      rv1FromHisLeads: num(rv1FromHisLeads),
      ttfcAvgMinutes, // 👈 nouveau TTFC (CALL_REQUESTED -> CALL_ATTEMPT par SETTER)


      revenueFromHisLeads,
      salesFromHisLeads: num(salesFromHisLeads),


      spendShare: Number(spendShare.toFixed(2)),
      cpl, cpRv0, cpRv1, roas,


      rv1PlannedFromHisLeads:  num(rv1PlannedFromHisLeads),
      rv1CanceledFromHisLeads: num(rv1CanceledFromHisLeads),
    });
  }


  return rows;
}

  /** Compte par jour via StageEvent.toStage (occurredAt). */
  private async perDayFromStageEvents(
    toStages: (LeadStage | string)[],
    from?: string,
    to?: string,
    tz = 'Europe/Paris',
  ): Promise<{ total: number; byDay?: Array<{ day: string; count: number }> }> {
    const r = toRange(from, to);
    const stageEnums = toStages.map(s => s as LeadStage);

    // No window → just total (unchanged)
    if (!r.from || !r.to) {
      const total = await this.prisma.stageEvent.count({ where: { toStage: { in: stageEnums } } });
      return { total: num(total), byDay: [] };
    }

    // Aggregate by *local* calendar day
    const stageList = Prisma.join(stageEnums.map(s => Prisma.sql`${s}::"LeadStage"`));
    const rows = await this.prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
      SELECT
        to_char(DATE_TRUNC('day', (se."occurredAt" AT TIME ZONE ${tz})), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM "StageEvent" se
      WHERE se."toStage" = ANY(ARRAY[${stageList}]::"LeadStage"[])
        AND ${whereLocalDay('occurredAt', from, to, tz)}
      GROUP BY 1
      ORDER BY 1 ASC
    `);

    // Fill missing local days, keep labels as YYYY-MM-DD (local day)
    const map = new Map(rows.map(r0 => [r0.day, num(r0.count)]));
    const byDay = daysSpanLocal(from, to).map(d => ({ day: d, count: map.get(d) ?? 0 }));
    const total = byDay.reduce((s, r0) => s + r0.count, 0);
    return { total, byDay };
  }

  /* =================== STAGE SERIES (générique) =================== */
  /**
   * Séries journalières génériques basées sur l’entrée dans un stage.
   * Ex: stage = 'CALL_REQUESTED' | 'CALL_ATTEMPT' | 'CALL_ANSWERED' | 'RV0_CANCELED' | etc.
   */
  async stageSeries(stage: string, from?: string, to?: string, tz = 'Europe/Paris') {
    return this.perDayFromStageEvents([stage as unknown as LeadStage], from, to, tz);
  }


  /* =================== CANCELED DAILY (RV0/RV1/RV2) =================== */
  async canceledDaily(from?: string, to?: string, tz = 'Europe/Paris') {
  if (!from || !to) {
    const total = await this.prisma.appointment.count({ where: { status: AppointmentStatus.CANCELED } });
    return { total: num(total), byDay: [] as Array<any> };
  }

  const byDay: Array<{ day: string; RV0_CANCELED: number; RV1_CANCELED: number; RV2_CANCELED: number; total: number }> = [];
  for (const day of daysSpanLocal(from, to)) {
    const daySql = Prisma.sql`${day}::date`;

    const [rv0, rv1, rv2] = await Promise.all([
      this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS n
        FROM "Appointment"
        WHERE "type" = 'RV0'
          AND "status" = 'CANCELED'
          AND (("scheduledAt" AT TIME ZONE ${tz})::date = ${daySql})
      `),
      this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS n
        FROM "Appointment"
        WHERE "type" = 'RV1'
          AND "status" = 'CANCELED'
          AND (("scheduledAt" AT TIME ZONE ${tz})::date = ${daySql})
      `),
      this.prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS n
        FROM "Appointment"
        WHERE "type" = 'RV2'
          AND "status" = 'CANCELED'
          AND (("scheduledAt" AT TIME ZONE ${tz})::date = ${daySql})
      `),
    ]);

    const r0 = num(rv0?.[0]?.n ?? 0);
    const r1 = num(rv1?.[0]?.n ?? 0);
    const r2 = num(rv2?.[0]?.n ?? 0);

    byDay.push({ day, RV0_CANCELED: r0, RV1_CANCELED: r1, RV2_CANCELED: r2, total: r0 + r1 + r2 });
  }

  const total = byDay.reduce((s, x) => s + num(x.total), 0);
  return { total, byDay };
}

  /* ---------------- Closers (tout via StageEvent) ---------------- */
  async closersReport(from?: string, to?: string): Promise<CloserRow[]> {
    const r = toRange(from, to);
    const closers = await this.prisma.user.findMany({
      where: { role: Role.CLOSER, isActive: true },
      select: { id: true, firstName: true, email: true },
      orderBy: { firstName: 'asc' },
    });


    const spend = await this.sumSpend(r);


    const rows: CloserRow[] = [];
    for (const c of closers) {
      // Agrégations StageEvent côté closer (occurredAt dans [from;to])
      const [
        rv1Planned,
        rv1HonoredCount,
        rv1NoShow,
        rv1Canceled,
        rv2Planned,
        rv2Honored,
        rv2Canceled,
      ] = await Promise.all([
        this.countSE({ stages: [LeadStage.RV1_PLANNED],  r, by: { closerId: c.id } }),
        this.countSE({ stages: [LeadStage.RV1_HONORED],  r, by: { closerId: c.id } }),
        this.countSE({ stages: [LeadStage.RV1_NO_SHOW],  r, by: { closerId: c.id } }),
        this.countSE({ stages: [LeadStage.RV1_CANCELED], r, by: { closerId: c.id } }),
        this.countSE({ stages: [LeadStage.RV2_PLANNED],  r, by: { closerId: c.id } }),
        this.countSE({ stages: [LeadStage.RV2_HONORED],  r, by: { closerId: c.id } }),
        this.countSE({ stages: [LeadStage.RV2_NO_SHOW],  r, by: { closerId: c.id } }),
        this.countSE({ stages: [LeadStage.RV2_CANCELED], r, by: { closerId: c.id } }),
      ]);


      // Ventes/CA rattachées au closer (même logique WON que partout)
      const wonWhere: any = await this.wonFilter(r);
      wonWhere.closerId = c.id;
      const wonAgg = await this.prisma.lead.aggregate({
        _sum: { saleValue: true },
        where: wonWhere,
      });
      const revenueTotal = num(wonAgg._sum?.saleValue ?? 0);
      const salesClosed = await this.prisma.lead.count({ where: wonWhere });


      // ROAS contextualisés (ex: par RV1 planned/honored)
      const roasPlanned = rv1Planned
        ? Number(((revenueTotal || 0) / (spend || 1) / rv1Planned).toFixed(2))
        : null;
      const roasHonored = rv1HonoredCount
        ? Number(((revenueTotal || 0) / (spend || 1) / rv1HonoredCount).toFixed(2))
        : null;


      const rv1CancelRate = rv1Planned ? Number((rv1Canceled / rv1Planned).toFixed(4)) : null;
      const rv2CancelRate = rv2Planned ? Number((rv2Canceled / rv2Planned).toFixed(4)) : null;


      rows.push({
        userId: c.id,
        name: c.firstName,
        email: c.email,


        rv1Planned: num(rv1Planned),
        rv1Honored: num(rv1HonoredCount),
        rv1NoShow: num(rv1NoShow),


        rv2Planned: num(rv2Planned),
        rv2Honored: num(rv2Honored),


        salesClosed: num(salesClosed),
        revenueTotal,
        roasPlanned,
        roasHonored,


        rv1Canceled: num(rv1Canceled),
        rv2Canceled: num(rv2Canceled),
        rv1CancelRate,
        rv2CancelRate,
      });
    }


    // Tri : CA desc puis ventes desc
    rows.sort(
      (a, b) =>
        b.revenueTotal - a.revenueTotal ||
        b.salesClosed - a.salesClosed,
    );


    return rows;
  }


  /* ====================== SPOTLIGHT SETTERS ====================== */
  // ✅ B. Dans spotlightSetters(...), complète le mapping :
async spotlightSetters(from?: string, to?: string): Promise<SpotlightSetterRow[]> {
  const base = await this.settersReport(from, to);


  const rows: SpotlightSetterRow[] = base.map((r) => {
    const rv1CancelRate =
      r.rv1PlannedFromHisLeads ? Number((r.rv1CanceledFromHisLeads / r.rv1PlannedFromHisLeads).toFixed(4)) : null;
    const settingRate =
      r.leadsReceived ? Number((r.rv1PlannedFromHisLeads / r.leadsReceived).toFixed(4)) : null;


    return {
      userId: r.userId,
      name: r.name,
      email: r.email,


      rv1PlannedOnHisLeads: r.rv1PlannedFromHisLeads,
      rv1DoneOnHisLeads: r.rv1FromHisLeads,          // ✅ “RV1 honorés (ses leads)”
      rv1CanceledOnHisLeads: r.rv1CanceledFromHisLeads,
      rv1CancelRate,


      salesFromHisLeads: r.salesFromHisLeads,
      revenueFromHisLeads: r.revenueFromHisLeads,


      settingRate,
      leadsReceived: r.leadsReceived,


      ttfcAvgMinutes: r.ttfcAvgMinutes,              // ✅ on renvoie le TTFC
    };
  });


  rows.sort(
    (a, b) =>
      b.revenueFromHisLeads - a.revenueFromHisLeads ||
      b.rv1PlannedOnHisLeads - a.rv1PlannedOnHisLeads,
  );
  return rows;
}


  /* ====================== SPOTLIGHT CLOSERS ====================== */
  async spotlightClosers(from?: string, to?: string): Promise<SpotlightCloserRow[]> {
    const base = await this.closersReport(from, to);


    const rows: SpotlightCloserRow[] = base.map((r) => {
      // Taux de closing = ventes / RV1 honorés
      const closingRate =
        r.rv1Honored ? Number((r.salesClosed / r.rv1Honored).toFixed(4)) : null;


      return {
        userId: r.userId,
        name: r.name,
        email: r.email,


        rv1Planned: r.rv1Planned,
        rv1Honored: r.rv1Honored,
        rv1Canceled: r.rv1Canceled,
        rv1CancelRate: r.rv1CancelRate,


        rv2Planned: r.rv2Planned,
        rv2Canceled: r.rv2Canceled,
        rv2CancelRate: r.rv2CancelRate,


        salesClosed: r.salesClosed,
        revenueTotal: r.revenueTotal,
        closingRate,
      };
    });


    // Tri : CA desc puis ventes desc
    rows.sort(
      (a, b) =>
        b.revenueTotal - a.revenueTotal ||
        b.salesClosed - a.salesClosed,
    );


    return rows;
  }


  /* ---------------- Équipe de choc (duos setter × closer) ---------------- */
  async duosReport(from?: string, to?: string): Promise<DuoRow[]> {
    const r = toRange(from, to);
    const where = await this.wonFilter(r);
    // on ne garde que les leads avec setter + closer
    (where as any).setterId = { not: null };
    (where as any).closerId = { not: null };


    const leads = await this.prisma.lead.findMany({
      where,
      select: {
        id: true,
        saleValue: true,
        setterId: true,
        closerId: true,
        setter: { select: { id: true, firstName: true, email: true } },
        closer: { select: { id: true, firstName: true, email: true } },
      },
    });


    type DuoAgg = {
      setterId: string;
      setterName: string;
      setterEmail: string;
      closerId: string;
      closerName: string;
      closerEmail: string;
      leadIds: string[];
      salesCount: number;
      revenue: number;
      rv1Planned: number;
      rv1Honored: number;
    };


    const map = new Map<string, DuoAgg>();


    for (const L of leads) {
      if (!L.setterId || !L.closerId || !L.setter || !L.closer) continue;
      const key = `${L.setterId}::${L.closerId}`;
      const row =
        map.get(key) ??
        {
          setterId: L.setterId,
          setterName: L.setter.firstName,
          setterEmail: L.setter.email,
          closerId: L.closerId,
          closerName: L.closer.firstName,
          closerEmail: L.closer.email,
          leadIds: [],
          salesCount: 0,
          revenue: 0,
          rv1Planned: 0,
          rv1Honored: 0,
        };


      row.leadIds.push(L.id);
      row.salesCount += 1;
      row.revenue += num(L.saleValue ?? 0);


      map.set(key, row);
    }


    // Compléter avec les RV1 pour chaque duo (via Appointment — si souhaité, on peut migrer ici aussi vers StageEvent)
    for (const duo of map.values()) {
      if (!duo.leadIds.length) continue;


      const rv1Planned = await this.prisma.appointment.count({
        where: {
          type: AppointmentType.RV1,
          leadId: { in: duo.leadIds },
        },
      });


      const rv1Honored = await this.prisma.appointment.count({
        where: {
          type: AppointmentType.RV1,
          leadId: { in: duo.leadIds },
          status: AppointmentStatus.HONORED,
        },
      });


      duo.rv1Planned = num(rv1Planned);
      duo.rv1Honored = num(rv1Honored);
    }


    const out: DuoRow[] = Array.from(map.values()).map((d) => ({
      setterId: d.setterId,
      setterName: d.setterName,
      setterEmail: d.setterEmail,
      closerId: d.closerId,
      closerName: d.closerName,
      closerEmail: d.closerEmail,
      salesCount: d.salesCount,
      revenue: d.revenue,
      avgDeal: d.salesCount ? Math.round(d.revenue / d.salesCount) : 0,
      rv1Planned: d.rv1Planned,
      rv1Honored: d.rv1Honored,
      rv1HonorRate: d.rv1Planned ? Math.round((d.rv1Honored / d.rv1Planned) * 100) : null,
    }));


    // Tri : plus gros CA en premier
    return out.sort((a, b) => b.revenue - a.revenue);
  }


  /* ---------------- Résumé ---------------- */
  async summary(from?: string, to?: string): Promise<SummaryOut> {
    const r = toRange(from, to);
    const [leads, wonAgg, setters, closers] = await Promise.all([
      this.leadsReceived(from, to),
      (async () => {
        const where = await this.wonFilter(r);
        const agg = await this.prisma.lead.aggregate({
          _sum: { saleValue: true },
          _count: { _all: true },
          where,
        });
        return { revenue: num(agg._sum.saleValue ?? 0), count: num(agg._count._all ?? 0) };
      })(),
      this.settersReport(from, to),
      this.closersReport(from, to),
    ]);


    const spend = await this.sumSpend(r);


    return {
      period: { from, to },
      totals: {
        leads: num(leads.total),
        revenue: wonAgg.revenue,
        salesCount: wonAgg.count,
        spend: num(spend),
        roas: spend ? Number((wonAgg.revenue / spend).toFixed(2)) : null,
        settersCount: (setters as any).length,
        closersCount: (closers as any).length,
        rv1Honored: (closers as any).reduce((s: number, r0: any) => s + num(r0.rv1Honored || 0), 0),
      },
    };
  }


  /* ========================================================================
     ======================  NOUVEAU : STAGE-ONLY  ==========================
     ======================================================================*/


  /** Récupère les IDs de Stage dynamiques pour une liste de slugs (= clés Pipeline). */
  private async stageIdsForKeys(keys: string[]): Promise<string[]> {
    if (!keys?.length) return [];
    const rows = await this.prisma.stage.findMany({
      where: { slug: { in: keys }, isActive: true },
      select: { id: true },
    });
    return rows.map(r => r.id);
  }


  /** Compte les leads qui ont ENTRÉ dans l’un des stages `keys` pendant [from;to] (via stageUpdatedAt). */
  private async countEnteredInStages(keys: string[], r: Range): Promise<number> {
    if (!keys?.length) return 0;
    const ids = await this.stageIdsForKeys(keys);
    const where: any = {
      AND: [
        { OR: [{ stage: { in: keys as any } }, ...(ids.length ? [{ stageId: { in: ids } }] : [])] },
        between('stageUpdatedAt', r),
      ],
    };
    return num(await this.prisma.lead.count({ where }));
  }


  /** Compte les leads ACTUELLEMENT dans l’un des stages `keys` (peu importe stageUpdatedAt). */
  private async countCurrentInStages(keys: string[]): Promise<number> {
    if (!keys?.length) return 0;
    const ids = await this.stageIdsForKeys(keys);
    const where: any = { OR: [{ stage: { in: keys as any } }, ...(ids.length ? [{ stageId: { in: ids } }] : [])] };
    return num(await this.prisma.lead.count({ where }));
  }


  /* ----------- Batch métriques pipeline pour le front (funnel cartes) ----------- */
  async pipelineMetrics(args: {
    keys: string[];
    from?: string;
    to?: string;
    mode?: 'entered' | 'current';
  }): Promise<Record<string, number>> {
    const { keys, from, to, mode = 'entered' } = args;
    const r = toRange(from, to);
    const unique = Array.from(new Set(keys));


    const out: Record<string, number> = {};
    await Promise.all(
      unique.map(async (k) => {
        out[k] =
          mode === 'current'
            ? await this.countCurrentInStages([k])
            : await this.countEnteredInStages([k], r);
      }),
    );
    return out;
  }


  /* ---------------- Funnel (TOUT via stages, comme Leads/WON) ---------------- */
  private async funnelFromStages(r: Range): Promise<FunnelTotals> {
    const get = (keys: string[]) => this.countEnteredInStages(keys, r);


    // ✅ version alignée avec FunnelTotals (sans POSTPONED)
    const [
      leadsCreated,
      callReq,
      calls,
      answered,
      setterNoShow,
      rv0P, rv0H, rv0NS, rv0C,
      rv1P, rv1H, rv1NS, rv1C,
      rv2P, rv2H, rv2NS, rv2C,
      notQual, lost,
      wonCount,
      appointmentCanceled,
    ] = await Promise.all([
      this.prisma.lead.count({ where: between('createdAt', r) }),


      get(['CALL_REQUESTED']),
      get(['CALL_ATTEMPT']),
      get(['CALL_ANSWERED']),
      get(['SETTER_NO_SHOW']),


      get(['RV0_PLANNED']), get(['RV0_HONORED']), get(['RV0_NO_SHOW']), get(['RV0_CANCELED']),


      get(['RV1_PLANNED']), get(['RV1_HONORED']), get(['RV1_NO_SHOW']), get(['RV1_CANCELED']),


      get(['RV2_PLANNED']), get(['RV2_HONORED']), get(['RV2_NO_SHOW']), get(['RV2_CANCELED']),


      get(['NOT_QUALIFIED']), get(['LOST']),


      // → utilise le même critère que partout ailleurs pour WON
      (async () => {
        const where = await this.wonFilter(r);
        return this.prisma.lead.count({ where });
      })(),


      this.prisma.appointment.count({
        where: { status: AppointmentStatus.CANCELED, ...between('scheduledAt', r) },
      }),
    ]);


    return {
      leads: num(leadsCreated),
      callRequests: num(callReq),
      callsTotal: num(calls),
      callsAnswered: num(answered),
      setterNoShow: num(setterNoShow),


      rv0Planned: num(rv0P),
      rv0Honored: num(rv0H),
      rv0NoShow: num(rv0NS),
      rv0Canceled: num(rv0C),


      rv1Planned: num(rv1P),
      rv1Honored: num(rv1H),
      rv1NoShow: num(rv1NS),
      rv1Canceled: num(rv1C),


      rv2Planned: num(rv2P),
      rv2Honored: num(rv2H),
      rv2NoShow: num(rv2NS),

      rv2Canceled: num(rv2C),


      notQualified: num(notQual),
      lost: num(lost),
      wonCount: num(wonCount),


      appointmentCanceled: num(appointmentCanceled),
    };


  }


  async funnel(from?: string, to?: string): Promise<FunnelOut> {
    const r = toRange(from, to);
    const totals = await this.funnelFromStages(r);


    const start = mondayOfUTC(r.from ?? new Date());
    const end = sundayOfUTC(r.to ?? new Date());


    const weekly: FunnelWeeklyRow[] = [];
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const ws = mondayOfUTC(d);
      const we = sundayOfUTC(d);
      const clip = intersectWindow(ws, we, r.from, r.to);
      const wRange: Range = { from: clip?.start, to: clip?.end };
      const wTotals = await this.funnelFromStages(wRange);
      weekly.push({ weekStart: ws.toISOString(), weekEnd: we.toISOString(), ...wTotals });
    }


    return { period: { from, to }, totals, weekly };
  }


  /* ---------------- Weekly series (pour /reporting/weekly-ops) ---------------- */
  async weeklySeries(from?: string, to?: string): Promise<WeeklyOpsRow[]> {
    const r = toRange(from, to);
    const start = mondayOfUTC(r.from ?? new Date());
    const end = sundayOfUTC(r.to ?? new Date());
    const out: WeeklyOpsRow[] = [];


    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
      const ws = mondayOfUTC(d);
      const we = sundayOfUTC(d);
      const clip = intersectWindow(ws, we, r.from, r.to);
      const wRange: Range = { from: clip?.start, to: clip?.end };


      const row: WeeklyOpsRow = {
        weekStart: ws.toISOString(),
        weekEnd: we.toISOString(),
        rv0Planned: await this.countEnteredInStages(['RV0_PLANNED'], wRange),
        rv0Honored: await this.countEnteredInStages(['RV0_HONORED'], wRange),
        rv0NoShow: await this.countEnteredInStages(['RV0_NO_SHOW'], wRange),

        rv1Planned: await this.countEnteredInStages(['RV1_PLANNED'], wRange),
        rv1Honored: await this.countEnteredInStages(['RV1_HONORED'], wRange),
        rv1NoShow: await this.countEnteredInStages(['RV1_NO_SHOW'], wRange),

        rv2Planned: await this.countEnteredInStages(['RV2_PLANNED'], wRange),
        rv2Honored: await this.countEnteredInStages(['RV2_HONORED'], wRange),
        rv2NoShow: await this.countEnteredInStages(['RV2_NO_SHOW'], wRange),
        rv2Postponed: await this.countEnteredInStages(['RV2_POSTPONED'], wRange),
        
        notQualified: await this.countEnteredInStages(['NOT_QUALIFIED'], wRange),
        lost: await this.countEnteredInStages(['LOST'], wRange),
      };
      out.push(row);
    }
    return out;
  }


  /* =================== METRICS JOURNALIÈRES BASÉES SUR LES STAGES =================== */


  /** Compte par jour le nombre de leads qui sont ENTRÉS dans l’un des stages `keys` (via stageUpdatedAt). */
  private async perDayFromStages(
  keys: string[],
  from?: string,
  to?: string,
  tz = 'Europe/Paris',
): Promise<{ total: number; byDay?: Array<{ day: string; count: number }> }> {
  const ids = await this.stageIdsForKeys(keys);

  if (!from || !to) {
    const where: any = { OR: [{ stage: { in: keys as any } }, ...(ids.length ? [{ stageId: { in: ids } }] : [])] };
    const total = await this.prisma.lead.count({ where });
    return { total: num(total), byDay: [] };
  }

  const rows = await this.prisma.$queryRaw<Array<{ day: string; count: number }>>(Prisma.sql`
    SELECT
      to_char(DATE_TRUNC('day', (l."stageUpdatedAt" AT TIME ZONE ${tz})), 'YYYY-MM-DD') AS day,
      COUNT(*)::int AS count
    FROM "Lead" l
    WHERE ( ${Prisma.join(
      [
        Prisma.sql`l."stage" = ANY(${Prisma.sql`ARRAY[${Prisma.join(keys.map(k => Prisma.sql`${k}::"LeadStage"`))}]::"LeadStage"[]`})`,
        ...(ids.length ? [Prisma.sql`l."stageId" = ANY(${Prisma.sql`ARRAY[${Prisma.join(ids)}]`})`] : []),
      ],
      ' OR ',
    )} )
      AND ${whereLocalDay('stageUpdatedAt', from, to, tz)}
    GROUP BY 1
    ORDER BY 1 ASC
  `);

  const map = new Map(rows.map(r0 => [r0.day, num(r0.count)]));
  const byDay = daysSpanLocal(from, to).map(d => ({ day: d, count: map.get(d) ?? 0 }));
  const total = byDay.reduce((s, r0) => s + r0.count, 0);
  return { total, byDay };
}



  /** Demandes d’appel par jour — basées sur l’entrée en stage CALL_REQUESTED */
  async metricCallRequests(from?: string, to?: string) {
    return this.perDayFromStages(['CALL_REQUESTED'], from, to);
  }


  /** Appels passés par jour — basés sur l’entrée en stage CALL_ATTEMPT */
  async metricCalls(from?: string, to?: string) {
    return this.perDayFromStages(['CALL_ATTEMPT'], from, to);
  }


  /** Appels répondus par jour — basés sur l’entrée en stage CALL_ANSWERED */
  async metricCallsAnswered(from?: string, to?: string) {
    return this.perDayFromStages(['CALL_ANSWERED'], from, to);
  }


  async metricCallsCanceled0(f?: string, t?: string, tz = 'Europe/Paris') {
    return this.perDayFromStageEvents([LeadStage.RV0_CANCELED], f, t, tz);
  }

  async metricCallsCanceled1(f?: string, t?: string, tz = 'Europe/Paris') {
    return this.perDayFromStageEvents([LeadStage.RV1_CANCELED], f, t, tz);
  }
  
  async metricCallsCanceled2(f?: string, t?: string, tz = 'Europe/Paris') {
    return this.perDayFromStageEvents([LeadStage.RV2_CANCELED], f, t, tz);
  }

  /* ---------------- DRILLS ---------------- */


  async drillLeadsReceived(args: { from?: string; to?: string; limit: number }) {
    const r = toRange(args.from, args.to);
    const rows = await this.prisma.lead.findMany({
      where: between('createdAt', r),
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true,
        setter: { select: { id: true, firstName: true, email: true } },
        closer: { select: { id: true, firstName: true, email: true } },
        saleValue: true,
      },
    });
    const items = rows.map((L) => ({
      leadId: L.id,
      leadName: [L.firstName, L.lastName].filter(Boolean).join(' ') || '—',
      email: L.email, phone: L.phone,
      setter: L.setter ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email } : null,
      closer: L.closer ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email } : null,
      appointment: null,
      saleValue: L.saleValue ?? null,
      createdAt: L.createdAt.toISOString(),
    }));
    return { ok: true, count: items.length, items };
  }


  async drillWon(args: { from?: string; to?: string; limit: number }) {
    const r = toRange(args.from, args.to);
    const where = await this.wonFilter(r);
    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: { stageUpdatedAt: 'desc' },
      take: args.limit,
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        setter: { select: { id: true, firstName: true, email: true } },
        closer: { select: { id: true, firstName: true, email: true } },
        saleValue: true, createdAt: true, stageUpdatedAt: true,
      },
    });
    const items = rows.map((L) => ({
      leadId: L.id,
      leadName: [L.firstName, L.lastName].filter(Boolean).join(' ') || '—',
      email: L.email, phone: L.phone,
      setter: L.setter ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email } : null,
      closer: L.closer ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email } : null,
      appointment: null,
      saleValue: L.saleValue ?? null,
      createdAt: L.createdAt.toISOString(),
      stageUpdatedAt: L.stageUpdatedAt.toISOString(),
    }));
    return { ok: true, count: items.length, items };
  }


    async drillAppointments(args: {
    from?: string;
    to?: string;
    type?: 'RV0' | 'RV1' | 'RV2';
    status?: 'PLANNED' | 'HONORED' | 'POSTPONED' | 'CANCELED' | 'NO_SHOW' | 'NOT_QUALIFIED';
    userId?: string;
    limit: number;
  }) {
    const { from, to, type, status, userId } = args;
    const limit = args.limit ?? 2000;
    const r = toRange(from, to);

    // 1) On mappe (type,status) -> liste de LeadStage, alignée sur funnelFromStages
    const stages: LeadStage[] = [];
    const push = (s: LeadStage) => {
      if (!stages.includes(s)) stages.push(s);
    };

    if (type === 'RV0') {
      if (!status || status === 'PLANNED')  push(LeadStage.RV0_PLANNED);
      if (!status || status === 'HONORED')  push(LeadStage.RV0_HONORED);
      if (!status || status === 'NO_SHOW')  push(LeadStage.RV0_NO_SHOW);
      if (!status || status === 'CANCELED') push(LeadStage.RV0_CANCELED);
    } else if (type === 'RV1') {
      if (!status || status === 'PLANNED')  push(LeadStage.RV1_PLANNED);
      if (!status || status === 'HONORED')  push(LeadStage.RV1_HONORED);
      if (!status || status === 'NO_SHOW')  push(LeadStage.RV1_NO_SHOW);
      if (!status || status === 'CANCELED') push(LeadStage.RV1_CANCELED);
    } else if (type === 'RV2') {
      if (!status || status === 'PLANNED')  push(LeadStage.RV2_PLANNED);
      if (!status || status === 'HONORED')  push(LeadStage.RV2_HONORED);
      if (!status || status === 'NO_SHOW')  push(LeadStage.RV2_NO_SHOW);
      if (!status || status === 'CANCELED') push(LeadStage.RV2_CANCELED);
      if (status === 'POSTPONED')          push(LeadStage.RV2_POSTPONED as any);
    }

    // Cas particulier : tuile "NOT_QUALIFIED" sans type RVx
    if (!type && status === 'NOT_QUALIFIED') {
      push(LeadStage.NOT_QUALIFIED);
    }

    if (!stages.length) {
      return { ok: true as const, count: 0, items: [] as any[] };
    }

    // 2) WHERE sur StageEvent, aligné avec funnelFromStages
    const where: Prisma.StageEventWhereInput = {
      toStage: { in: stages },
      ...between('occurredAt', r),
    };

    // Gestion de userId : on colle à la logique setters/closers
    if (userId) {
      const leadFilter: any = {};
      if (type === 'RV0') {
        // RV0 = côté SETTER
        leadFilter.setterId = userId;
      } else if (type === 'RV1' || type === 'RV2') {
        // RV1/RV2 = côté CLOSER
        leadFilter.closerId = userId;
      }

      if (Object.keys(leadFilter).length) {
        (where as any).lead = { ...(where as any).lead, ...leadFilter };
      } else {
        // fallback sécurité si un jour tu appelles avec un type différent
        (where as any).userId = userId;
      }
    }

    const rows = await this.prisma.stageEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: limit,
      select: {
        occurredAt: true,
        toStage: true,
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            setter: { select: { id: true, firstName: true, email: true } },
            closer: { select: { id: true, firstName: true, email: true } },
            saleValue: true,
            createdAt: true,
            stageUpdatedAt: true,
          },
        },
      },
    });

    // Helpers pour reconstruire type + status côté front
    const statusFromStage = (s: LeadStage): string => {
      switch (s) {
        case LeadStage.RV0_PLANNED:
        case LeadStage.RV1_PLANNED:
        case LeadStage.RV2_PLANNED:
          return 'PLANNED';
        case LeadStage.RV0_HONORED:
        case LeadStage.RV1_HONORED:
        case LeadStage.RV2_HONORED:
          return 'HONORED';
        case LeadStage.RV0_NO_SHOW:
        case LeadStage.RV1_NO_SHOW:
        case LeadStage.RV2_NO_SHOW:
          return 'NO_SHOW';
        case LeadStage.RV0_CANCELED:
        case LeadStage.RV1_CANCELED:
        case LeadStage.RV2_CANCELED:
          return 'CANCELED';
        case LeadStage.NOT_QUALIFIED:
          return 'NOT_QUALIFIED';
        default:
          return 'UNKNOWN';
      }
    };

    const typeFromStage = (s: LeadStage): string => {
      const v = String(s);
      if (v.startsWith('RV0_')) return 'RV0';
      if (v.startsWith('RV1_')) return 'RV1';
      if (v.startsWith('RV2_')) return 'RV2';
      return 'PIPELINE';
    };

    const items = rows
      .filter((r0) => !!r0.lead)
      .map((r0) => {
        const L = r0.lead!;
        const inferredStatus = statusFromStage(r0.toStage);
        const inferredType = typeFromStage(r0.toStage);

        // Si le front a envoyé un status/type précis, on le garde ; sinon on prend celui du stage
        const appStatus = status ?? inferredStatus;
        const appType = type ?? inferredType;

        return {
          leadId: L.id,
          leadName: [L.firstName, L.lastName].filter(Boolean).join(' ') || '—',
          email: L.email,
          phone: L.phone,
          setter: L.setter
            ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email }
            : null,
          closer: L.closer
            ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email }
            : null,
          appointment: {
            type: appType,
            status: appStatus as any,
            // on utilise occurredAt comme date de l’événement
            scheduledAt: r0.occurredAt.toISOString(),
          },
          saleValue: L.saleValue ?? null,
          createdAt: L.createdAt.toISOString(),
          stageUpdatedAt: L.stageUpdatedAt.toISOString(),
        };
      });

    return { ok: true as const, count: items.length, items };
  }


  async drillCallRequests(args: { from?: string; to?: string; limit: number }) {
    const r = toRange(args.from, args.to);
    const rows = await this.prisma.callRequest.findMany({
      where: between('requestedAt', r),
      orderBy: { requestedAt: 'desc' },
      take: args.limit,
      select: {
        requestedAt: true, channel: true, status: true,
        lead: {
          select: {
            id: true, firstName: true, lastName: true, email: true, phone: true,
            setter: { select: { id: true, firstName: true, email: true } },
            closer: { select: { id: true, firstName: true, email: true } },
            saleValue: true, createdAt: true, stageUpdatedAt: true,
          },
        },
      },
    });
    const items = rows
      .filter((r0) => !!r0.lead)
      .map((r0) => {
        const L = r0.lead!;
        return {
          leadId: L.id,
          leadName: [L.firstName, L.lastName].filter(Boolean).join(' ') || '—',
          email: L.email, phone: L.phone,
          setter: L.setter ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email } : null,
          closer: L.closer ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email } : null,
          appointment: { type: 'CALL_REQUEST', status: r0.status as any, scheduledAt: r0.requestedAt.toISOString() },
          saleValue: L.saleValue ?? null,
          createdAt: L.createdAt.toISOString(),
          stageUpdatedAt: L.stageUpdatedAt.toISOString(),
        };
      });
    return { ok: true, count: items.length, items };
  }


  async drillCalls(args: {
    from?: string;
    to?: string;
    answered?: boolean;
    setterNoShow?: boolean;
    limit: number;
  }) {
    if (args.answered) {
      const r = toRange(args.from, args.to);
      const rows = await this.prisma.callAttempt.findMany({
        where: { outcome: CallOutcome.ANSWERED, ...between('startedAt', r) },
        orderBy: { startedAt: 'asc' }, // (asc/desc — libre)
        take: args.limit,
        select: {
          startedAt: true, outcome: true, userId: true,
          lead: {
            select: {
              id: true, firstName: true, lastName: true, email: true, phone: true,
              setter: { select: { id: true, firstName: true, email: true } },
              closer: { select: { id: true, firstName: true, email: true } },
              saleValue: true, createdAt: true, stageUpdatedAt: true,
            },
          },
        },
      });
      const items = rows
        .filter((r0) => !!r0.lead)
        .map((r0) => {
          const L = r0.lead!;
          return {
            leadId: L.id,
            leadName: [L.firstName, L.lastName].filter(Boolean).join(' ') || '—',
            email: L.email, phone: L.phone,
            setter: L.setter ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email } : null,
            closer: L.closer ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email } : null,
            appointment: { type: 'CALL', status: r0.outcome as any, scheduledAt: r0.startedAt.toISOString() },
            saleValue: L.saleValue ?? null,
            createdAt: L.createdAt.toISOString(),
            stageUpdatedAt: L.stageUpdatedAt.toISOString(),
          };
        });
      return { ok: true, count: items.length, items };
    }


    if (args.setterNoShow) {
      const r = toRange(args.from, args.to);
      const rows = await this.prisma.lead.findMany({
        where: { stage: LeadStage.SETTER_NO_SHOW, ...between('stageUpdatedAt', r) },
        orderBy: { stageUpdatedAt: 'desc' },
        take: args.limit,
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          setter: { select: { id: true, firstName: true, email: true } },
          closer: { select: { id: true, firstName: true, email: true } },
          saleValue: true, createdAt: true, stageUpdatedAt: true,
        },
      });
      const items = rows.map((L) => ({
        leadId: L.id,
        leadName: [L.firstName, L.lastName].filter(Boolean).join(' ') || '—',
        email: L.email, phone: L.phone,
        setter: L.setter ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email } : null,
        closer: L.closer ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email } : null,
        appointment: null,
        saleValue: L.saleValue ?? null,
        createdAt: L.createdAt.toISOString(),
        stageUpdatedAt: L.stageUpdatedAt.toISOString(),
      }));
      return { ok: true, count: items.length, items };
    }


    const r = toRange(args.from, args.to);
    const rows = await this.prisma.callAttempt.findMany({
      where: between('startedAt', r),
      orderBy: { startedAt: 'desc' },
      take: args.limit,
      select: {
        startedAt: true, outcome: true, userId: true,
        lead: {
          select: {
            id: true, firstName: true, lastName: true, email: true, phone: true,
            setter: { select: { id: true, firstName: true, email: true } },
            closer: { select: { id: true, firstName: true, email: true } },
            saleValue: true, createdAt: true, stageUpdatedAt: true,
          },
        },
      },
    });
    const items = rows
      .filter((r0) => !!r0.lead)
      .map((r0) => {
        const L = r0.lead!;
        return {
          leadId: L.id,
          leadName: [L.firstName, L.lastName].filter(Boolean).join(' ') || '—',
          email: L.email, phone: L.phone,
          setter: L.setter ? { id: L.setter.id, name: L.setter.firstName, email: L.setter.email } : null,
          closer: L.closer ? { id: L.closer.id, name: L.closer.firstName, email: L.closer.email } : null,
          appointment: { type: 'CALL', status: r0.outcome as any, scheduledAt: r0.startedAt.toISOString() },
          saleValue: L.saleValue ?? null,
          createdAt: L.createdAt.toISOString(),
          stageUpdatedAt: L.stageUpdatedAt.toISOString(),
        };
      });
    return { ok: true, count: items.length, items };
  }
}



