import { base44 } from "@/api/base44Client";

// Social layer: notifications + private messaging. All calls run as the
// current app user; RLS on the entities enforces privacy.

export function emitSocialUpdate() {
  try { window.dispatchEvent(new Event("e621-social-update")); } catch {}
}

// ---------- Notifications ----------

// Notify `toUserId` of an action by the current user. Dedupes by
// (user_id, actor_id, type, target_id) so re-follow / re-like won't spam.
// `actorId` lets callers reuse a known id and skip an extra auth.me() call.
export async function notify(toUserId, { type, targetId = "", preview = "", actorId } = {}) {
  if (!toUserId) return;
  let me;
  if (actorId) me = { id: actorId };
  else me = await base44.auth.me().catch(() => null);
  if (!me || me.id === toUserId) return; // never notify yourself
  try {
    const existing = await base44.entities.Notification.filter(
      { user_id: toUserId, actor_id: me.id, type, target_id: targetId },
      { limit: 1 }
    );
    if ((existing.items || existing).length) return;
    await base44.entities.Notification.create({
      user_id: toUserId,
      actor_id: me.id,
      type,
      target_id: targetId,
      preview,
      read: false,
    });
    emitSocialUpdate();
  } catch {}
}

export async function getUnreadCounts(meId) {
  if (!meId) return { notifications: 0, messages: 0 };
  const [n, m] = await Promise.all([
    base44.entities.Notification.count({ user_id: meId, read: false }).catch(() => 0),
    base44.entities.Message.count({ recipient_id: meId, read: false }).catch(() => 0),
  ]);
  return { notifications: n, messages: m };
}

export async function markAllNotificationsRead() {
  const me = await base44.auth.me().catch(() => null);
  if (!me) return;
  try {
    const res = await base44.entities.Notification.filter({ user_id: me.id, read: false }, { limit: 200 });
    const items = res.items || res;
    if (items.length) await base44.entities.Notification.bulkUpdate(items.map((n) => ({ id: n.id, read: true })));
    emitSocialUpdate();
  } catch {}
}

// ---------- Messaging ----------

// Find an existing conversation between two users (either direction).
async function findConversation(aId, bId) {
  const res = await base44.entities.Conversation.filter(
    { $or: [ { initiator_id: aId, recipient_id: bId }, { initiator_id: bId, recipient_id: aId } ] },
    { limit: 1 }
  );
  return (res.items || res)[0] || null;
}

// Start (or resume) a conversation with `toUserId`, optionally with a first
// message. Reopens a previously declined conversation. Returns the conversation.
export async function startConversation(toUserId, firstMessage = "") {
  const me = await base44.auth.me().catch(() => null);
  if (!me || me.id === toUserId) throw new Error("invalid");
  let conv = await findConversation(me.id, toUserId);
  if (conv) {
    if (conv.status === "declined") {
      conv = await base44.entities.Conversation.update(conv.id, { status: "pending" });
    }
  } else {
    conv = await base44.entities.Conversation.create({
      initiator_id: me.id,
      recipient_id: toUserId,
      status: "pending",
      last_message: "",
      last_sender_id: "",
    });
  }
  if (firstMessage.trim()) {
    await sendMessage(conv, firstMessage.trim(), true);
    await notify(toUserId, { type: "message_request", targetId: conv.id, preview: firstMessage.trim(), actorId: me.id });
  }
  emitSocialUpdate();
  return conv;
}

// Send a message in a conversation. `conv` must include id, initiator_id,
// recipient_id. Returns the created message. When isRequest is true the
// message notification is suppressed (startConversation sends its own request
// notification instead).
export async function sendMessage(conv, body, isRequest = false) {
  const me = await base44.auth.me().catch(() => null);
  if (!me) throw new Error("auth");
  const recipientId = conv.initiator_id === me.id ? conv.recipient_id : conv.initiator_id;
  const msg = await base44.entities.Message.create({
    conversation_id: conv.id,
    sender_id: me.id,
    recipient_id: recipientId,
    body,
    read: false,
  });
  await base44.entities.Conversation.update(conv.id, { last_message: body, last_sender_id: me.id });
  if (!isRequest) {
    await notify(recipientId, { type: "message", targetId: conv.id, preview: body, actorId: me.id });
  }
  emitSocialUpdate();
  return msg;
}

export async function acceptConversation(convId) {
  const c = await base44.entities.Conversation.update(convId, { status: "accepted" });
  emitSocialUpdate();
  return c;
}
export async function declineConversation(convId) {
  const c = await base44.entities.Conversation.update(convId, { status: "declined" });
  emitSocialUpdate();
  return c;
}

// Mark all messages in a conversation where I'm the recipient as read.
export async function markConversationRead(conv) {
  const me = await base44.auth.me().catch(() => null);
  if (!me || !conv) return;
  try {
    const res = await base44.entities.Message.filter(
      { conversation_id: conv.id, recipient_id: me.id, read: false },
      { limit: 200 }
    );
    const items = res.items || res;
    if (items.length) await base44.entities.Message.bulkUpdate(items.map((m) => ({ id: m.id, read: true })));
    emitSocialUpdate();
  } catch {}
}
