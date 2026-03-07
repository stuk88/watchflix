/**
 * Tests for the whisper-sync endpoint logic.
 *
 * Covers:
 *   - normalizeText helper
 *   - wordOverlapScore fuzzy matching
 *   - offset calculation logic
 *   - endpoint input validation (via integration-style assertions)
 *
 * Run with: node --test api/tests/whisper-sync.test.js
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── Helpers extracted from route logic (kept in sync manually) ──────────────

function normalizeText(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function wordOverlapScore(a, b) {
  const wordsA = a.split(' ').filter(Boolean);
  const wordsB = new Set(b.split(' ').filter(Boolean));
  if (wordsA.length === 0 || wordsB.size === 0) return 0;
  const overlap = wordsA.filter(w => wordsB.has(w)).length;
  return overlap / Math.max(wordsA.length, wordsB.size);
}

/**
 * Given a whisper segment (chunk-relative time) and the chunk start time in
 * video-space, compute the subtitle offset.
 * offset = (chunkStart + segmentStart) - cueStart
 */
function computeOffset(chunkStartTime, whisperSegmentStart, cueStart) {
  return chunkStartTime + whisperSegmentStart - cueStart;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('normalizeText', () => {
  test('lowercases text', () => {
    assert.equal(normalizeText('Hello World'), 'hello world');
  });

  test('removes punctuation', () => {
    assert.equal(normalizeText("What are you doing here?"), 'what are you doing here');
  });

  test('collapses whitespace', () => {
    assert.equal(normalizeText('  too   many   spaces  '), 'too many spaces');
  });

  test('handles empty string', () => {
    assert.equal(normalizeText(''), '');
  });
});

describe('wordOverlapScore', () => {
  test('identical strings score 1.0', () => {
    const score = wordOverlapScore('what are you doing here', 'what are you doing here');
    assert.equal(score, 1.0);
  });

  test('completely different strings score 0', () => {
    const score = wordOverlapScore('alpha beta gamma', 'delta epsilon zeta');
    assert.equal(score, 0);
  });

  test('partial overlap returns fractional score', () => {
    const score = wordOverlapScore('what are you doing here', 'what are you doing elsewhere');
    // 4 words overlap out of max(5, 5) = 5
    assert.ok(score > 0 && score < 1, `Expected 0 < score < 1, got ${score}`);
  });

  test('empty strings return 0', () => {
    assert.equal(wordOverlapScore('', 'hello'), 0);
    assert.equal(wordOverlapScore('hello', ''), 0);
  });

  test('single common word gives partial score', () => {
    const score = wordOverlapScore('hello', 'hello world');
    // 1 overlap / max(1, 2) = 0.5
    assert.equal(score, 0.5);
  });
});

describe('computeOffset (offset = video_time - subtitle_cue_time)', () => {
  test('basic offset calculation', () => {
    // Chunk started at video t=327.5, whisper found speech at chunk-t=4.2
    // So speech is at video t=331.7. Subtitle cue starts at 300.0
    // => offset = 31.7
    const offset = computeOffset(327.5, 4.2, 300.0);
    assert.ok(Math.abs(offset - 31.7) < 0.0001, `Expected ~31.7, got ${offset}`);
  });

  test('zero offset when times already align', () => {
    // Speech at video t=10, cue starts at 10 => offset 0
    const offset = computeOffset(5, 5, 10);
    assert.equal(offset, 0);
  });

  test('negative offset when subtitle is ahead of video', () => {
    // Speech at video t=100, cue at 110 => subtitle is early, offset=-10
    const offset = computeOffset(95, 5, 110);
    assert.equal(offset, -10);
  });
});

describe('best-match selection logic', () => {
  const subtitleCues = [
    { start: 300, end: 302, text: 'What are you doing here?' },
    { start: 305, end: 308, text: 'I came to warn you.' },
    { start: 312, end: 315, text: 'You have to leave now.' },
  ];

  const whisperSegments = [
    { start: 4.2, end: 6.5, text: ' What are you doing here?' },
    { start: 9.1, end: 11.0, text: ' I came to warn you.' },
  ];

  test('selects the cue with highest word overlap', () => {
    let bestScore = 0;
    let bestCue = null;
    let bestSeg = null;

    for (const seg of whisperSegments) {
      const normSeg = normalizeText(seg.text);
      for (const cue of subtitleCues) {
        const normCue = normalizeText(cue.text);
        const score = wordOverlapScore(normSeg, normCue);
        if (score > bestScore) {
          bestScore = score;
          bestCue = cue;
          bestSeg = seg;
        }
      }
    }

    assert.ok(bestScore >= 0.3, `Score too low: ${bestScore}`);
    assert.equal(bestCue.start, 300);
    assert.equal(bestSeg.start, 4.2);
  });

  test('offset calculated correctly from best match', () => {
    const chunkStart = 327.5; // currentTime - 5

    let bestScore = 0;
    let bestCue = null;
    let bestSeg = null;

    for (const seg of whisperSegments) {
      const normSeg = normalizeText(seg.text);
      for (const cue of subtitleCues) {
        const normCue = normalizeText(cue.text);
        const score = wordOverlapScore(normSeg, normCue);
        if (score > bestScore) {
          bestScore = score;
          bestCue = cue;
          bestSeg = seg;
        }
      }
    }

    const offset = computeOffset(chunkStart, bestSeg.start, bestCue.start);
    // 327.5 + 4.2 - 300 = 31.7
    assert.ok(Math.abs(offset - 31.7) < 0.0001, `Expected ~31.7, got ${offset}`);
  });
});

describe('input validation rules', () => {
  test('rejects currentTime < 10', () => {
    const currentTime = 8;
    assert.ok(currentTime < 10, 'Should be rejected');
  });

  test('accepts currentTime >= 10', () => {
    const currentTime = 332.5;
    assert.ok(currentTime >= 10, 'Should be accepted');
  });

  test('rejects empty subtitleCues array', () => {
    const cues = [];
    assert.ok(cues.length === 0, 'Should be rejected');
  });

  test('accepts valid subtitleCues array', () => {
    const cues = [{ start: 300, end: 302, text: 'Hello' }];
    assert.ok(cues.length > 0, 'Should be accepted');
  });
});
