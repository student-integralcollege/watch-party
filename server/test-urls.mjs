import { extractVideoId } from "../client/src/utils/youtube.js";

const testCases = [
  { input: "dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/watch?feature=shared&v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "http://www.youtube.com/watch?v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "youtube.com/watch?v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "www.youtube.com/watch?v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://youtu.be/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://youtu.be/dQw4w9WgXcQ?si=abc12345", expected: "dQw4w9WgXcQ" },
  { input: "youtu.be/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/embed/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "<iframe width=\"560\" height=\"315\" src=\"https://www.youtube.com/embed/dQw4w9WgXcQ\" title=\"YouTube video player\"></iframe>", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/shorts/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/shorts/dQw4w9WgXcQ/", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/watch/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://music.youtube.com/watch?v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://m.youtube.com/watch?v=dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120s&feature=shared", expected: "dQw4w9WgXcQ" },
  { input: "https://www.youtube.com/live/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "\u200Ehttps://youtu.be/dQw4w9WgXcQ\u200F", expected: "dQw4w9WgXcQ" },
  { input: "https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "Check out this song: https://youtu.be/dQw4w9WgXcQ", expected: "dQw4w9WgXcQ" },
  { input: "\"https://www.youtube.com/watch?v=dQw4w9WgXcQ\"", expected: "dQw4w9WgXcQ" },
  { input: "<https://youtu.be/dQw4w9WgXcQ>", expected: "dQw4w9WgXcQ" },
  { input: "invalid url", expected: null },
  { input: "", expected: null },
];

let passed = 0;
let failed = 0;

for (const { input, expected } of testCases) {
  const result = extractVideoId(input);
  if (expected === null) {
    if (!result.valid) {
      console.log(`✓ PASS: Invalid input rejected properly`);
      passed++;
    } else {
      console.error(`✗ FAIL: Expected invalid, but got valid: ${result.videoId} for "${input}"`);
      failed++;
    }
  } else {
    if (result.valid && result.videoId === expected) {
      console.log(`✓ PASS: Extracted "${expected}" from "${input.slice(0, 50)}..."`);
      passed++;
    } else {
      console.error(`✗ FAIL: For "${input}", expected "${expected}", got:`, result);
      failed++;
    }
  }
}

console.log(`\nALL TEST CASES: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
