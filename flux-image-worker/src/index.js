/**
 * FLUX.1-schnell Worker with Cloudflare R2 Storage & Course Folder Partitioning
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function sanitizePath(str) {
  return (str || 'general')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-\.]/g, '');
}

async function generateSingleImage(ai, prompt) {
  const result = await ai.run('@cf/black-forest-labs/flux-1-schnell', {
    prompt: prompt,
    num_steps: 4,
  });

  if (result && result.image) {
    const binary = atob(result.image);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  } else if (result instanceof ReadableStream || result instanceof ArrayBuffer) {
    return result;
  } else if (result && typeof result.arrayBuffer === 'function') {
    return await result.arrayBuffer();
  }
  throw new Error('Unrecognized image format returned from Workers AI');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // 1. Single Image Generation & Save
      if (path === '/api/generate' && request.method === 'POST') {
        const body = await request.json();
        const { course_code, name, prompt, description } = body;
        const finalPrompt = prompt || description;

        if (!finalPrompt || !name) {
          return jsonResponse({ error: 'Missing prompt or image name' }, 400);
        }

        const courseFolder = sanitizePath(course_code || 'MISC');
        const fileName = sanitizePath(name);
        const r2Key = `${courseFolder}/${fileName}`;

        const buffer = await generateSingleImage(env.AI, finalPrompt);

        await env.IMAGES_BUCKET.put(r2Key, buffer, {
          httpMetadata: { contentType: 'image/png' },
          customMetadata: {
            course_code: course_code || 'MISC',
            prompt: finalPrompt.substring(0, 500),
            created_at: new Date().toISOString(),
          },
        });

        return jsonResponse({
          success: true,
          key: r2Key,
          filename: fileName,
          course: courseFolder,
          url: `/api/image/${encodeURIComponent(r2Key)}`,
        });
      }

      // 2. Batch Concurrent Generation & Save
      if (path === '/api/batch-generate' && request.method === 'POST') {
        const body = await request.json();
        const { course_code, images } = body;

        if (!Array.isArray(images) || images.length === 0) {
          return jsonResponse({ error: 'Payload must include an images array' }, 400);
        }

        const courseFolder = sanitizePath(course_code || 'MISC');

        // Execute all generations concurrently using Promise.allSettled
        const tasks = images.map(async (item) => {
          const finalPrompt = item.prompt || item.description;
          const fileName = sanitizePath(item.name || `image_${Date.now()}.png`);
          const r2Key = `${courseFolder}/${fileName}`;

          try {
            const buffer = await generateSingleImage(env.AI, finalPrompt);
            await env.IMAGES_BUCKET.put(r2Key, buffer, {
              httpMetadata: { contentType: 'image/png' },
              customMetadata: {
                course_code: course_code || 'MISC',
                prompt: finalPrompt.substring(0, 500),
                created_at: new Date().toISOString(),
              },
            });
            return {
              status: 'fulfilled',
              key: r2Key,
              name: fileName,
              url: `/api/image/${encodeURIComponent(r2Key)}`,
            };
          } catch (err) {
            return {
              status: 'rejected',
              name: fileName,
              error: err.message,
            };
          }
        });

        const results = await Promise.all(tasks);

        return jsonResponse({
          success: true,
          course: courseFolder,
          total: images.length,
          results: results,
        });
      }

      // 3. Browse Stored Images in R2
      if (path === '/api/browse' && request.method === 'GET') {
        const courseParam = url.searchParams.get('course');
        const prefix = courseParam ? `${sanitizePath(courseParam)}/` : '';

        const listed = await env.IMAGES_BUCKET.list({
          prefix: prefix,
          limit: 100,
        });

        const items = listed.objects.map((obj) => ({
          key: obj.key,
          filename: obj.key.split('/').pop(),
          folder: obj.key.split('/')[0],
          size: obj.size,
          uploaded: obj.uploaded,
          metadata: obj.customMetadata,
          url: `/api/image/${encodeURIComponent(obj.key)}`,
        }));

        return jsonResponse({
          success: true,
          count: items.length,
          prefix: prefix,
          items: items,
        });
      }

      // 4. Stream Raw Image from R2
      if (path.startsWith('/api/image/')) {
        const key = decodeURIComponent(path.replace('/api/image/', ''));
        const object = await env.IMAGES_BUCKET.get(key);

        if (!object) {
          return new Response('Image not found in R2', { status: 404, headers: CORS_HEADERS });
        }

        const headers = new Headers(CORS_HEADERS);
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);
        headers.set('Cache-Control', 'public, max-age=31536000, immutable');
        headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');

        return new Response(object.body, { headers });
      }

      // 5. Delete an Image
      if (path.startsWith('/api/delete/') && request.method === 'DELETE') {
        const key = decodeURIComponent(path.replace('/api/delete/', ''));
        await env.IMAGES_BUCKET.delete(key);
        return jsonResponse({ success: true, deleted: key });
      }

      return jsonResponse({ error: 'Endpoint not found', path }, 404);
    } catch (error) {
      return jsonResponse({ error: error.message || 'Worker Internal Error' }, 500);
    }
  },
};