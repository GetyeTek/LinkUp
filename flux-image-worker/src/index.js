/**
 * FLUX.1 Worker with Supabase Storage (public_assets/tutor_images/)
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const BUCKET_NAME = 'public_assets';
const ROOT_FOLDER = 'tutor_images';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

function sanitizeSegment(str) {
  return (str || 'general')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-\.]/g, '');
}

function getSupabaseConfig(env, body = {}) {
  const url = (env.SUPABASE_URL || body.supabase_url || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY || body.supabase_key || '';
  return { url, key };
}

async function generateSingleImage(ai, prompt) {
  const result = await ai.run('@cf/black-forest-labs/flux-1-schnell', {
    prompt: prompt,
    steps: 4,
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

async function uploadToSupabase({ url, key, courseFolder, fileName, buffer }) {
  const storagePath = `${ROOT_FOLDER}/${courseFolder}/${fileName}`;
  const uploadEndpoint = `${url}/storage/v1/object/${BUCKET_NAME}/${storagePath}`;

  const res = await fetch(uploadEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'apikey': key,
      'Content-Type': 'image/png',
      'x-upsert': 'true',
    },
    body: buffer,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Supabase Storage upload failed (${res.status}): ${errText}`);
  }

  const publicUrl = `${url}/storage/v1/object/public/${BUCKET_NAME}/${storagePath}`;
  return { storagePath, publicUrl };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // 1. Single Image Generation & Supabase Upload
      if (path === '/api/generate' && request.method === 'POST') {
        const body = await request.json();
        const { course_code, name, prompt, description } = body;
        const finalPrompt = prompt || description;

        if (!finalPrompt || !name) {
          return jsonResponse({ error: 'Missing prompt or image name' }, 400);
        }

        const { url: supaUrl, key: supaKey } = getSupabaseConfig(env, body);
        if (!supaUrl || !supaKey) {
          return jsonResponse({ error: 'Supabase credentials missing in Worker environment' }, 500);
        }

        const courseFolder = sanitizeSegment(course_code || 'MISC');
        const fileName = sanitizeSegment(name);

        const buffer = await generateSingleImage(env.AI, finalPrompt);
        const { storagePath, publicUrl } = await uploadToSupabase({
          url: supaUrl,
          key: supaKey,
          courseFolder,
          fileName,
          buffer,
        });

        return jsonResponse({
          success: true,
          filename: fileName,
          course: courseFolder,
          storage_path: storagePath,
          url: publicUrl,
        });
      }

      // 2. Batch Concurrent Generation & Upload
      if (path === '/api/batch-generate' && request.method === 'POST') {
        const body = await request.json();
        const { course_code, images } = body;

        if (!Array.isArray(images) || images.length === 0) {
          return jsonResponse({ error: 'Payload must include an images array' }, 400);
        }

        const { url: supaUrl, key: supaKey } = getSupabaseConfig(env, body);
        if (!supaUrl || !supaKey) {
          return jsonResponse({ error: 'Supabase credentials missing in Worker environment' }, 500);
        }

        const courseFolder = sanitizeSegment(course_code || 'MISC');

        const tasks = images.map(async (item) => {
          const finalPrompt = item.prompt || item.description;
          const fileName = sanitizeSegment(item.name || `image_${Date.now()}.png`);

          try {
            const buffer = await generateSingleImage(env.AI, finalPrompt);
            const { storagePath, publicUrl } = await uploadToSupabase({
              url: supaUrl,
              key: supaKey,
              courseFolder,
              fileName,
              buffer,
            });

            return {
              status: 'fulfilled',
              name: fileName,
              storage_path: storagePath,
              url: publicUrl,
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
          results,
        });
      }

      // 3. Browse Stored Images in Supabase public_assets
      if (path === '/api/browse' && request.method === 'GET') {
        const { url: supaUrl, key: supaKey } = getSupabaseConfig(env);
        if (!supaUrl || !supaKey) {
          return jsonResponse({ error: 'Supabase credentials missing in Worker environment' }, 500);
        }

        const courseParam = url.searchParams.get('course') || '';
        const courseFolder = sanitizeSegment(courseParam);
        const prefix = courseParam ? `${ROOT_FOLDER}/${courseFolder}` : ROOT_FOLDER;

        const listEndpoint = `${supaUrl}/storage/v1/object/list/${BUCKET_NAME}`;
        const listRes = await fetch(listEndpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supaKey}`,
            'apikey': supaKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            prefix: prefix,
            limit: 100,
            sortBy: { column: 'name', order: 'asc' },
          }),
        });

        if (!listRes.ok) {
          const err = await listRes.text();
          return jsonResponse({ error: `Supabase list error: ${err}` }, listRes.status);
        }

        const files = await listRes.json();
        const items = (Array.isArray(files) ? files : [])
          .filter(f => f.name !== '.emptyFolderPlaceholder')
          .map((f) => {
            const fullPath = `${prefix}/${f.name}`;
            return {
              filename: f.name,
              folder: courseFolder,
              storage_path: fullPath,
              size: f.metadata?.size || 0,
              created_at: f.created_at,
              url: `${supaUrl}/storage/v1/object/public/${BUCKET_NAME}/${fullPath}`,
            };
          });

        return jsonResponse({
          success: true,
          count: items.length,
          folder: courseFolder,
          items,
        });
      }

      // 4. Delete an Image from Supabase
      if (path === '/api/delete' && request.method === 'DELETE') {
        const { url: supaUrl, key: supaKey } = getSupabaseConfig(env);
        const body = await request.json();
        const { path: targetPath } = body;

        if (!targetPath) return jsonResponse({ error: 'Missing path' }, 400);

        const deleteEndpoint = `${supaUrl}/storage/v1/object/${BUCKET_NAME}`;
        await fetch(deleteEndpoint, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${supaKey}`,
            'apikey': supaKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ prefixes: [targetPath] }),
        });

        return jsonResponse({ success: true, deleted: targetPath });
      }

      return jsonResponse({ error: 'Endpoint not found', path }, 404);
    } catch (error) {
      return jsonResponse({ error: error.message || 'Worker Internal Error' }, 500);
    }
  },
};