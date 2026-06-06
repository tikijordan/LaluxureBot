import { getContentType } from '@whiskeysockets/baileys';

export const normalizePhone = n => (n || '').replace(/\D/g, '').replace(/^0+/, '');

export function unwrapMessageContent(message, depth = 0) {
    if (!message || depth > 4) return message;
    if (message.ephemeralMessage?.message) return unwrapMessageContent(message.ephemeralMessage.message, depth + 1);
    if (message.viewOnceMessage?.message) return unwrapMessageContent(message.viewOnceMessage.message, depth + 1);
    if (message.viewOnceMessageV2?.message) return unwrapMessageContent(message.viewOnceMessageV2.message, depth + 1);
    if (message.documentWithCaptionMessage?.message) return unwrapMessageContent(message.documentWithCaptionMessage.message, depth + 1);
    if (message.editedMessage?.message) return unwrapMessageContent(message.editedMessage.message, depth + 1);
    if (message.deviceSentMessage?.message) return unwrapMessageContent(message.deviceSentMessage.message, depth + 1);
    return message;
}

export function extractMessageBody(msg) {
    const inner = unwrapMessageContent(msg.message);
    if (!inner) return '';
    const ct = getContentType(inner);
    if (ct === 'conversation') return inner.conversation || '';
    if (ct === 'extendedTextMessage') return inner.extendedTextMessage?.text || '';
    if (ct === 'imageMessage') return inner.imageMessage?.caption || '';
    if (ct === 'videoMessage') return inner.videoMessage?.caption || '';
    if (ct === 'buttonsResponseMessage') return inner.buttonsResponseMessage?.selectedDisplayText || inner.buttonsResponseMessage?.selectedButtonId || '';
    if (ct === 'listResponseMessage') return inner.listResponseMessage?.title || inner.listResponseMessage?.singleSelectReply?.selectedRowId || '';
    if (ct === 'templateButtonReplyMessage') return inner.templateButtonReplyMessage?.selectedDisplayText || inner.templateButtonReplyMessage?.selectedId || '';
    return '';
}

export function resolveIsOwner({ fromMe, senderNumber, senderJid, OWNER, OWNER_LID, lidCache }) {
    if (fromMe) return true;
    const normOwner = normalizePhone(OWNER);
    const normSender = normalizePhone(senderNumber);
    if (normOwner && normSender && normOwner === normSender) return true;

    const senderLid = senderJid?.endsWith('@lid') ? senderJid.split('@')[0] : null;
    if (OWNER_LID && senderLid && senderLid === OWNER_LID) return true;
    // senderNumber peut être le LID brut si non résolu
    if (OWNER_LID && normSender && normSender === OWNER_LID) return true;

    const ownerLidCached = lidCache?.[normOwner];
    if (ownerLidCached && senderLid && senderLid === ownerLidCached) return true;
    if (ownerLidCached && normSender && normSender === ownerLidCached) return true;
    if (OWNER_LID && normSender && lidCache?.[OWNER_LID] === normSender) return true;

    return false;
}
