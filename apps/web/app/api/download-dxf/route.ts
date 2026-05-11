import { NextRequest, NextResponse } from 'next/server';

/**
 * DXF ダウンロードプロキシ。
 *
 * 一時ホスティングサービス (litterbox.catbox.moe 等) は DXF を text/plain として返すため、
 * ブラウザ上で開くとファイル内容がそのまま表示されてしまう。
 * このプロキシで Content-Disposition: attachment を強制し、必ずダウンロードさせる。
 *
 * 使い方:
 *   /api/download-dxf?u=<encoded upload url>&n=<filename>
 *
 *   - u: 必須。リダイレクトせずプロキシ取得する元 URL (許可ホストのみ受理)
 *   - n: 任意。ダウンロード時のファイル名 (デフォルト: barrel.dxf)
 */
export const runtime = 'nodejs';

/** プロキシを許可するホスト (オープンリダイレクト/SSRF 防止) */
const ALLOWED_HOSTS = new Set([
    'litter.catbox.moe',
    'files.catbox.moe',
    'a.uguu.se',
    'h.uguu.se',
    'tmpfiles.org',
    'www.tmpfiles.org',
]);

export async function GET(req: NextRequest): Promise<NextResponse> {
    const urlParam = req.nextUrl.searchParams.get('u');
    const filenameParam = req.nextUrl.searchParams.get('n');

    if (!urlParam) {
        return NextResponse.json({ error: 'u (URL) param missing' }, { status: 400 });
    }

    let upstream: URL;
    try {
        upstream = new URL(urlParam);
    } catch {
        return NextResponse.json({ error: 'invalid URL' }, { status: 400 });
    }

    if (upstream.protocol !== 'https:') {
        return NextResponse.json({ error: 'only https URLs allowed' }, { status: 400 });
    }

    if (!ALLOWED_HOSTS.has(upstream.hostname)) {
        return NextResponse.json(
            { error: `host not allowed: ${upstream.hostname}` },
            { status: 400 },
        );
    }

    // ファイル名のサニタイズ: パス区切り・改行・引用符を除去
    const safeFilename = (filenameParam ?? 'barrel.dxf').replace(/[\\/\r\n"]/g, '').slice(0, 128) || 'barrel.dxf';

    try {
        const res = await fetch(upstream.toString(), {
            // text/plain で返してくる場合があるので Accept は wildcard
            headers: { Accept: '*/*' },
        });
        if (!res.ok) {
            return NextResponse.json(
                { error: `upstream fetch failed: ${res.status} ${res.statusText}` },
                { status: 502 },
            );
        }
        const buffer = await res.arrayBuffer();
        return new NextResponse(buffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/dxf',
                'Content-Disposition': `attachment; filename="${safeFilename}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
                'Content-Length': String(buffer.byteLength),
                'Cache-Control': 'public, max-age=300', // 5分キャッシュ
            },
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: `proxy failed: ${msg}` }, { status: 502 });
    }
}
