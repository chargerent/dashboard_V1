/* eslint-env node */

const MAX_VOICE_PROMPT_BYTES = 8 * 1024 * 1024;

const VOICE_PROMPT_DEFINITIONS = Object.freeze({
  recording_notice: Object.freeze({
    label: "Recording and transcription notice",
    fallback: "This call may be recorded and transcribed for quality purposes.",
  }),
  hold_waiting: Object.freeze({
    label: "Caller hold message",
    fallback: "Thank you for calling Chargerent support. Please stay on the line while we connect you with the next available specialist.",
  }),
  staff_screen: Object.freeze({
    label: "Staff call screen",
    fallback: "Chargerent customer support call. Press 1 to accept.",
  }),
  connecting: Object.freeze({
    label: "Connecting caller",
    fallback: "Connecting you now.",
  }),
  callback_offer: Object.freeze({
    label: "Missed-call choices",
    fallback: "We are sorry we could not answer your call. Press 1 if you would like a Chargerent support specialist to call you back at the number you are calling from. Press 2 to leave a voicemail.",
  }),
  callback_confirmed: Object.freeze({
    label: "Callback confirmation",
    fallback: "Thank you. A Chargerent support specialist will call you back at the number you called from as soon as possible.",
  }),
  voicemail_greeting: Object.freeze({
    label: "Voicemail greeting",
    fallback: "We are sorry we missed your call. Please leave your name, phone number, rental location, and a short description after the tone. Please do not provide a complete card number.",
  }),
  voicemail_confirmed: Object.freeze({
    label: "Voicemail confirmation",
    fallback: "Thank you. A Chargerent support team member will follow up as soon as possible.",
  }),
});

function normalizeVoicePromptKey(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!Object.hasOwn(VOICE_PROMPT_DEFINITIONS, key)) {
    throw new Error("Choose a supported voice prompt.");
  }
  return key;
}

function voicePromptStoragePath(promptKey) {
  return `support-voice-prompts/${normalizeVoicePromptKey(promptKey)}.mp3`;
}

function looksLikeMp3(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3) return false;
  const hasId3Header = buffer.subarray(0, 3).toString("ascii") === "ID3";
  const hasFrameSync = buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
  return hasId3Header || hasFrameSync;
}

function decodeVoicePromptUpload(data = {}) {
  const promptKey = normalizeVoicePromptKey(data.promptKey);
  const fileName = String(data.fileName || "").trim().slice(0, 240);
  const contentType = String(data.contentType || "audio/mpeg").trim().toLowerCase();
  if (!/\.mp3$/i.test(fileName)) {
    throw new Error("Voice prompts must use the .mp3 file extension.");
  }
  if (!["audio/mpeg", "audio/mp3", "audio/x-mpeg", "application/octet-stream"].includes(contentType)) {
    throw new Error("Voice prompts must be MP3 audio.");
  }
  const encoded = String(data.dataBase64 || "").trim();
  if (!encoded || encoded.length % 4 !== 0 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("The MP3 upload is not valid base64 data.");
  }
  const buffer = Buffer.from(encoded, "base64");
  if (!buffer.length) throw new Error("The MP3 file is empty.");
  if (buffer.length > MAX_VOICE_PROMPT_BYTES) {
    throw new Error("Voice prompts must be 8 MB or smaller.");
  }
  if (!looksLikeMp3(buffer)) {
    throw new Error("The uploaded file does not contain valid MP3 audio.");
  }
  return {
    promptKey,
    fileName,
    contentType: "audio/mpeg",
    buffer,
  };
}

module.exports = {
  MAX_VOICE_PROMPT_BYTES,
  VOICE_PROMPT_DEFINITIONS,
  decodeVoicePromptUpload,
  looksLikeMp3,
  normalizeVoicePromptKey,
  voicePromptStoragePath,
};
