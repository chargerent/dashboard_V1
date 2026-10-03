/* eslint-env node */
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_VOICE_PROMPT_BYTES,
  VOICE_PROMPT_DEFINITIONS,
  decodeVoicePromptUpload,
  looksLikeMp3,
  normalizeVoicePromptKey,
  unansweredCallChoice,
  voicePromptStoragePath,
} = require("./supportVoicePrompts");

test("voice prompts expose every supported call phase", () => {
  assert.deepEqual(Object.keys(VOICE_PROMPT_DEFINITIONS), [
    "recording_notice",
    "hold_waiting",
    "staff_screen",
    "connecting",
    "callback_or_text",
    "callback_confirmed",
    "text_chat_available",
  ]);
  assert.equal(normalizeVoicePromptKey(" CALLBACK_OR_TEXT "), "callback_or_text");
  assert.equal(
      voicePromptStoragePath("callback_or_text"),
      "support-voice-prompts/callback_or_text.mp3",
  );
  assert.throws(() => normalizeVoicePromptKey("voicemail_greeting"), /supported voice prompt/);
  assert.throws(() => normalizeVoicePromptKey("unknown"), /supported voice prompt/);
  assert.doesNotMatch(JSON.stringify(VOICE_PROMPT_DEFINITIONS), /voicemail/i);
});

test("unanswered calls have only callback or text outcomes", () => {
  assert.equal(unansweredCallChoice("1"), "callback");
  assert.equal(unansweredCallChoice("2"), "text");
  assert.equal(unansweredCallChoice(""), "text");
});

test("voice prompt uploads validate MP3 content instead of trusting the file name", () => {
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
  assert.equal(looksLikeMp3(mp3), true);
  const upload = decodeVoicePromptUpload({
    promptKey: "callback_or_text",
    fileName: "callback-or-text.mp3",
    contentType: "audio/mpeg",
    dataBase64: mp3.toString("base64"),
  });
  assert.equal(upload.contentType, "audio/mpeg");
  assert.deepEqual(upload.buffer, mp3);
  assert.throws(() => decodeVoicePromptUpload({
    promptKey: "callback_or_text",
    fileName: "callback-or-text.mp3",
    contentType: "audio/mpeg",
    dataBase64: Buffer.from("not an mp3").toString("base64"),
  }), /valid MP3/);
  assert.throws(() => decodeVoicePromptUpload({
    promptKey: "callback_or_text",
    fileName: "callback-or-text.wav",
    contentType: "audio/wav",
    dataBase64: mp3.toString("base64"),
  }), /\.mp3/);
});

test("voice prompt uploads reject files above the size limit", () => {
  const oversized = Buffer.alloc(MAX_VOICE_PROMPT_BYTES + 1, 0);
  oversized.set(Buffer.from("ID3"));
  assert.throws(() => decodeVoicePromptUpload({
    promptKey: "connecting",
    fileName: "connecting.mp3",
    contentType: "audio/mpeg",
    dataBase64: oversized.toString("base64"),
  }), /8 MB or smaller/);
});
