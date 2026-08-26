import assert from "node:assert/strict";
import test from "node:test";

import { createBlakeChat, deleteBlakeChat, listBlakeChats, updateBlakeChat } from "./blake-chat-store";

test("Blake chats are private to tenant and user", () => {
  const tenant = `tenant-${crypto.randomUUID()}`;
  const brian = `brian-${crypto.randomUUID()}`;
  const errol = `errol-${crypto.randomUUID()}`;
  const chat = createBlakeChat(tenant, brian);

  assert.equal(listBlakeChats(tenant, brian).some((item) => item.id === chat.id), true);
  assert.equal(listBlakeChats(tenant, errol).some((item) => item.id === chat.id), false);
  assert.equal(listBlakeChats("another-tenant", brian).some((item) => item.id === chat.id), false);

  deleteBlakeChat(tenant, brian, chat.id);
});

test("Blake chat derives a useful title and persists messages", () => {
  const tenant = `tenant-${crypto.randomUUID()}`;
  const user = `user-${crypto.randomUUID()}`;
  const chat = createBlakeChat(tenant, user);
  const updated = updateBlakeChat(tenant, user, chat.id, {
    messages: [{
      id: crypto.randomUUID(),
      role: "user",
      text: "Which jobs currently have the tightest margins?",
      createdAt: new Date().toISOString(),
    }],
  });

  assert.equal(updated?.title, "Which jobs currently have the tightest margins?");
  assert.equal(listBlakeChats(tenant, user).find((item) => item.id === chat.id)?.messages.length, 1);

  deleteBlakeChat(tenant, user, chat.id);
});
