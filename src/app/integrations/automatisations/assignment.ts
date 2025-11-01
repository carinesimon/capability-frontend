import { PrismaService } from '@/prisma/prisma.service';
import { Role } from '@prisma/client';

type AssignRule = {
  role: 'SETTER' | 'CLOSER';
  by: 'email' | 'name' | 'static';
  from?: string;
  match?: { equals?: string; contains?: string; regex?: string };
  userId?: string;
};

type AssignConfig = {
  roundRobin?: { setter?: boolean; closer?: boolean };
  rules?: AssignRule[];
};

function getByPath(obj: any, path?: string) {
  if (!path) return undefined;
  return path.split('.').reduce((acc: any, k) => (acc != null ? acc[k] : undefined), obj);
}
const norm = (s?: string | null) => (s ?? '').toString().trim();

async function findUserForRule(prisma: PrismaService, rule: AssignRule, payload: any) {
  const role = rule.role === 'CLOSER' ? Role.CLOSER : Role.SETTER;

  if (rule.by === 'static' && rule.userId) {
    return await prisma.user.findFirst({ where: { id: rule.userId, role, isActive: true } });
  }

  const sourceVal = norm(getByPath(payload, rule.from));
  if (!sourceVal) return null;

  if (rule.by === 'email') {
    return await prisma.user.findFirst({ where: { role, isActive: true, email: sourceVal } });
  }

  if (rule.by === 'name') {
    return await prisma.user.findFirst({
      where: { role, isActive: true, firstName: { contains: sourceVal, mode: 'insensitive' } },
      orderBy: { firstName: 'asc' },
    });
  }

  if (rule.by === 'static' && rule.match) {
    const v = sourceVal;
    const { equals, contains, regex } = rule.match;
    let ok = false;
    if (equals) ok = v.toLowerCase() === equals.toLowerCase();
    else if (contains) ok = v.toLowerCase().includes(contains.toLowerCase());
    else if (regex) ok = new RegExp(regex).test(v);
    if (ok && rule.userId) {
      return await prisma.user.findFirst({ where: { id: rule.userId, role, isActive: true } });
    }
  }

  return null;
}

async function pickRoundRobinUser(prisma: PrismaService, role: Role, automationId: string) {
  const users = await prisma.user.findMany({
    where: { role, isActive: true },
    orderBy: { firstName: 'asc' },
    select: { id: true },
  });
  if (!users.length) return null;

  const a = await prisma.automation.findUnique({
    where: { id: automationId },
    select: { metaJson: true },
  });
  const meta = (a?.metaJson || {}) as any;
  meta.rrIndex ??= {};
  const key = role === Role.CLOSER ? 'closer' : 'setter';
  const idx = Number.isFinite(meta.rrIndex[key]) ? meta.rrIndex[key] : -1;
  const next = (idx + 1) % users.length;
  meta.rrIndex[key] = next;

  await prisma.automation.update({
    where: { id: automationId },
    data: { metaJson: meta },
  });

  return users[next];
}

/** Applique assignation sur un lead */
export async function applyAutoAssignment(opts: {
  prisma: PrismaService;
  automationId: string;
  mapping: { assign?: AssignConfig } | null | undefined;
  payload: any;
  leadId: string;
  runMode: 'ON' | 'DRY_RUN' | 'OFF';
}) {
  const { prisma, automationId, mapping, payload, leadId, runMode } = opts;
  const res: any = { assigned: [], usedRoundRobin: [] };

  const assign = mapping?.assign || {};
  const rules = Array.isArray(assign.rules) ? (assign.rules as AssignRule[]) : [];

  // 1) règles déclaratives
  for (const rule of rules) {
    const u = await findUserForRule(prisma, rule, payload);
    if (!u) continue;

    if (runMode === 'ON') {
      if (rule.role === 'SETTER') {
        await prisma.lead.update({ where: { id: leadId }, data: { setter: { connect: { id: u.id } } } });
      } else {
        await prisma.lead.update({ where: { id: leadId }, data: { closer: { connect: { id: u.id } } } });
      }
    }
    res.assigned.push({ role: rule.role, userId: u.id, via: 'rule' });
  }

  // 2) fallback round-robin
  const needSetter = !res.assigned.some((a: any) => a.role === 'SETTER');
  const needCloser = !res.assigned.some((a: any) => a.role === 'CLOSER');

  if (needSetter && assign.roundRobin?.setter) {
    const u = await pickRoundRobinUser(prisma, Role.SETTER, automationId);
    if (u) {
      if (runMode === 'ON') {
        await prisma.lead.update({ where: { id: leadId }, data: { setter: { connect: { id: u.id } } } });
      }
      res.assigned.push({ role: 'SETTER', userId: u.id, via: 'roundRobin' });
      res.usedRoundRobin.push('SETTER');
    }
  }

  if (needCloser && assign.roundRobin?.closer) {
    const u = await pickRoundRobinUser(prisma, Role.CLOSER, automationId);
    if (u) {
      if (runMode === 'ON') {
        await prisma.lead.update({ where: { id: leadId }, data: { closer: { connect: { id: u.id } } } });
      }
      res.assigned.push({ role: 'CLOSER', userId: u.id, via: 'roundRobin' });
      res.usedRoundRobin.push('CLOSER');
    }
  }

  return res;
  
}
