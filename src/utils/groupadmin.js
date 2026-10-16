/**
 * Helpers pour les actions admin de groupe — vérification des résultats et matching LID/PN.
 */

export function jidBase(jid) {
  return (jid || '').split(':')[0].split('@')[0];
}

export function participantIds(participant) {
  return [participant.id, participant.lid, participant.jid].filter(Boolean);
}

/** Compare un participant avec l'expéditeur (PN ou LID). */
export function participantMatches(participant, senderJid, senderNumber, lidCache = {}) {
  const pIds = participantIds(participant);
  const senderBases = new Set([jidBase(senderJid)]);
  if (senderNumber) {
    senderBases.add(senderNumber);
    if (lidCache[senderNumber]) senderBases.add(lidCache[senderNumber]);
  }
  const senderLid = senderJid?.endsWith('@lid') ? jidBase(senderJid) : lidCache[senderNumber] || null;
  if (senderLid) senderBases.add(senderLid);

  return pIds.some(pid => {
    const pb = jidBase(pid);
    return senderBases.has(pb);
  });
}

export function isGroupAdmin(participants, senderJid, senderNumber, lidCache) {
  return !!participants?.find(
    p => participantMatches(p, senderJid, senderNumber, lidCache) && (p.admin || p.isSuperAdmin)
  );
}

export function isBotGroupAdmin(participants, sock, lidCache) {
  const botNum = sock.user?.id?.split(':')[0]?.replace(/\D/g, '') || '';
  const botLid = sock.user?.lid ? jidBase(sock.user.lid) : null;
  const botIds = new Set([sock.user?.id, sock.user?.lid].filter(Boolean));
  if (botNum) botIds.add(`${botNum}@s.whatsapp.net`);
  if (botLid) botIds.add(`${botLid}@lid`);

  return !!participants?.find(p => {
    if (!(p.admin || p.isSuperAdmin)) return false;
    return participantIds(p).some(pid => {
      const pb = jidBase(pid);
      if (botLid && pb === botLid) return true;
      if (botNum && pb === botNum) return true;
      return [...botIds].some(bid => jidBase(bid) === pb);
    });
  });
}

/** Vérifie le statut retourné par groupParticipantsUpdate (Baileys). */
export function checkGroupActionResult(result, actionLabel = 'Action') {
  if (!result?.length) {
    return { ok: false, message: `${actionLabel} échouée — le bot n'est peut-être pas admin du groupe.` };
  }
  const status = String(result[0]?.status ?? '');
  if (status === '200') return { ok: true };
  if (status === '403') return { ok: false, message: `${actionLabel} refusée — permissions insuffisantes (403).` };
  if (status === '404') return { ok: false, message: `${actionLabel} échouée — membre introuvable (404).` };
  if (status === '408') return { ok: false, message: `${actionLabel} échouée — délai dépassé (408).` };
  return { ok: false, message: `${actionLabel} échouée (statut ${status || 'inconnu'}).` };
}

/** Rôle normalisé d'un participant : 'superadmin' | 'admin' | 'member'. */
export function participantRole(participant) {
  if (!participant) return 'member';
  if (participant.isSuperAdmin || participant.admin === 'superadmin') return 'superadmin';
  if (participant.admin === 'admin' || participant.admin === true) return 'admin';
  return 'member';
}

/** Résume les membres d'un groupe par rôle. */
export function summarizeGroupMembers(participants = []) {
  const summary = { superadmin: 0, admin: 0, member: 0, total: participants.length };
  for (const p of participants) summary[participantRole(p)]++;
  return summary;
}

/** Identifie si un participant correspond au propriétaire du bot (PN ou LID). */
export function isOwnerInGroup(participant, ownerNumber, ownerLid, lidCache = {}) {
  const ownerNum = (ownerNumber || '').replace(/\D/g, '').replace(/^0+/, '');
  const bases = new Set();
  if (ownerNum) bases.add(ownerNum);
  if (ownerLid) bases.add(String(ownerLid).replace(/\D/g, ''));
  return participantIds(participant).some(pid => {
    const pb = jidBase(pid).replace(/\D/g, '');
    return bases.has(pb);
  });
}
