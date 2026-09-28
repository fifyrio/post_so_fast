import { readFile } from 'node:fs/promises';

const INBOX_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const CONTENT_INIT_URL = 'https://open.tiktokapis.com/v2/post/publish/content/init/';
const STATUS_URL = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

const MB = 1024 * 1024;
const MAX_SINGLE_CHUNK = 64 * MB;
const DEFAULT_CHUNK = 10 * MB;

function authHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
  };
}

async function postJson(url, accessToken, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(accessToken),
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== 'ok') {
    const err = data.error;
    throw new Error(`TikTok API error: ${err?.code ?? res.status} — ${err?.message ?? 'unknown'}`);
  }
  return data.data;
}

// Splits a total size into TikTok-compliant chunk byte ranges.
function planChunks(size) {
  if (size <= MAX_SINGLE_CHUNK) {
    return { chunkSize: size, totalChunkCount: 1, ranges: [[0, size - 1]] };
  }
  const chunkSize = DEFAULT_CHUNK;
  const fullChunks = Math.floor(size / chunkSize);
  const ranges = [];
  for (let i = 0; i < fullChunks; i += 1) {
    const start = i * chunkSize;
    // Last full chunk absorbs the remainder so no trailing sub-chunk is sent.
    const end = i === fullChunks - 1 ? size - 1 : start + chunkSize - 1;
    ranges.push([start, end]);
  }
  return { chunkSize, totalChunkCount: fullChunks, ranges };
}

async function putChunk(uploadUrl, buffer, [start, end], totalSize, contentType) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${totalSize}`,
    },
    body: buffer.subarray(start, end + 1),
  });
  if (!res.ok && res.status !== 201 && res.status !== 206) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Chunk upload failed (${res.status}): ${detail.slice(0, 200)}`);
  }
}

// PULL_FROM_URL: TikTok fetches the (verified-domain) video URL itself.
export async function publishFromUrl(accessToken, videoUrl) {
  const data = await postJson(INBOX_INIT_URL, accessToken, {
    source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
  });
  return { publishId: data.publish_id };
}

// FILE_UPLOAD: we init, then PUT the bytes directly to the returned upload_url.
export async function publishFromFile(accessToken, filePath, contentType = 'video/mp4') {
  const buffer = await readFile(filePath);
  const size = buffer.length;
  const { chunkSize, totalChunkCount, ranges } = planChunks(size);

  const data = await postJson(INBOX_INIT_URL, accessToken, {
    source_info: {
      source: 'FILE_UPLOAD',
      video_size: size,
      chunk_size: chunkSize,
      total_chunk_count: totalChunkCount,
    },
  });

  for (const range of ranges) {
    await putChunk(data.upload_url, buffer, range, size, contentType);
  }
  return { publishId: data.publish_id };
}

// Photo carousel to the inbox/draft. Photos only support PULL_FROM_URL, so the
// images must already be hosted (we upload them to R2 first). MEDIA_UPLOAD =
// the draft flow: the post lands in the TikTok app for final edit and publish.
export async function publishPhotosFromUrls(accessToken, imageUrls, { title = '', description = '', coverIndex = 0 } = {}) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    throw new Error('At least one image URL is required');
  }
  const data = await postJson(CONTENT_INIT_URL, accessToken, {
    post_info: { title, description },
    source_info: {
      source: 'PULL_FROM_URL',
      photo_cover_index: coverIndex,
      photo_images: imageUrls,
    },
    post_mode: 'MEDIA_UPLOAD',
    media_type: 'PHOTO',
  });
  return { publishId: data.publish_id };
}

export async function fetchStatus(accessToken, publishId) {
  return postJson(STATUS_URL, accessToken, { publish_id: publishId });
}
