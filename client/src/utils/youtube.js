/**
 * Extracts and validates an 11-character YouTube video ID
 * from virtually any YouTube URL format, share text, embed code, or raw ID.
 *
 * Handles:
 * - Direct ID: dQw4w9WgXcQ
 * - Standard: https://www.youtube.com/watch?v=dQw4w9WgXcQ
 * - Reversed / extra query params: https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ
 * - Short URLs: https://youtu.be/dQw4w9WgXcQ?si=xyz123
 * - Embed tags / iframe codes: <iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
 * - Shorts: https://www.youtube.com/shorts/dQw4w9WgXcQ
 * - Live: https://www.youtube.com/live/dQw4w9WgXcQ
 * - Path-based: https://www.youtube.com/watch/dQw4w9WgXcQ
 * - Mobile / Music: m.youtube.com, music.youtube.com
 * - Protocol-less: youtube.com/watch?v=dQw4w9WgXcQ, youtu.be/dQw4w9WgXcQ
 * - Text containing links: "Watch this: https://youtu.be/dQw4w9WgXcQ!"
 * - Invisible unicode characters (BOM, LRM, RLM, zero-width space from mobile copy-paste)
 * - URL encoded strings: https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D...
 */
export function extractVideoId(input) {
  if (!input || typeof input !== "string") {
    return { valid: false, error: "Please enter a valid YouTube URL or video ID." };
  }

  // 1. Strip all invisible unicode control chars (BOM, zero-width, LTR/RTL marks, non-breaking spaces)
  let text = input.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E\u00A0]/g, " ").trim();

  // 2. Decode URL encoding if string was encoded
  try {
    if (text.includes("%")) {
      text = decodeURIComponent(text);
    }
  } catch (e) {
    // Ignore decode error if malformed %
  }

  // 3. Strip surrounding quotes, punctuation, brackets, and markdown formatting
  text = text.replace(/^["'“”‘’`<\[(\s]+|["'“”‘’`>\])\s.,;!?]+$/g, "").trim();

  // 4. Direct 11-character YouTube video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) {
    return { valid: true, videoId: text };
  }

  // 5. Targeted regex pattern matchers
  const patterns = [
    // Standard watch parameter: v=VIDEO_ID (handles ?v=, &v=, watch?v=, watch#!v=)
    /[?&]v=([a-zA-Z0-9_-]{11})(?:[&#?_\s]|$)/i,

    // Short links: youtu.be/VIDEO_ID
    /youtu\.be\/([a-zA-Z0-9_-]{11})(?:[?&#/\s]|$)/i,

    // Path segments: /embed/ID, /shorts/ID, /live/ID, /v/ID, /watch/ID, /e/ID
    /(?:embed|shorts|live|v|watch|e)\/([a-zA-Z0-9_-]{11})(?:[?&#/\s]|$)/i,

    // Iframe embed code: youtube.com/embed/VIDEO_ID
    /youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/i,

    // Attribution link or user link: u=/watch?v=VIDEO_ID
    /[?&]u=[^&]*watch.*?v=([a-zA-Z0-9_-]{11})/i,

    // Generic YouTube domain followed by 11-char ID
    /(?:youtube\.com|youtu\.be).*?([a-zA-Z0-9_-]{11})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1] && /^[a-zA-Z0-9_-]{11}$/.test(match[1])) {
      return { valid: true, videoId: match[1] };
    }
  }

  // 6. Structured URL parser fallback
  try {
    let urlStr = text;
    if (!/^https?:\/\//i.test(urlStr)) {
      urlStr = "https://" + urlStr;
    }
    const parsed = new URL(urlStr);

    // Check 'v' search param
    const v = parsed.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v.trim())) {
      return { valid: true, videoId: v.trim() };
    }

    // Check path segments
    const segments = parsed.pathname.split("/").map((s) => s.trim()).filter(Boolean);
    for (const segment of segments) {
      const cleanSeg = segment.split("?")[0].split("&")[0];
      if (/^[a-zA-Z0-9_-]{11}$/.test(cleanSeg)) {
        return { valid: true, videoId: cleanSeg };
      }
    }
  } catch (err) {
    // Fall through
  }

  // 7. Last-resort fallback: If input mentions 'youtu' and contains any 11-character alphanumeric token
  if (/youtu/i.test(text)) {
    const anyToken = text.match(/\b([a-zA-Z0-9_-]{11})\b/);
    if (anyToken && anyToken[1] && anyToken[1].toLowerCase() !== "watch_popup") {
      return { valid: true, videoId: anyToken[1] };
    }
  }

  return {
    valid: false,
    error: "Could not extract a valid YouTube video ID. Please check the URL format (e.g. youtube.com/watch?v=..., youtu.be/..., or 11-char ID).",
  };
}
