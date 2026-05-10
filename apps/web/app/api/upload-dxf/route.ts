import { NextRequest, NextResponse } from 'next/server';

/**
 * DXF ファイルをサーバーサイドからファイルホスティングサービスに転送し、公開 URL を返す API ルート。
 *
 * ブラウザ → /api/upload-dxf → 外部サービス の経路にすることで:
 * - CORS 制約を回避 (server-to-server 通信は CORS 対象外)
 * - User-Agent / リクエストヘッダーを完全制御できる
 *
 * リクエスト: multipart/form-data with 'file' field
 * レスポンス: { url: string, provider: string } または { error: string }
 *
 * プロバイダ優先順位:
 *   1. catbox.moe       - 永続保存、200MB まで、安定 (推奨)
 *   2. tmpfiles.org     - 60 分有効、フォールバック
 */
export const runtime = 'nodejs'; // Edge runtime ではない (FormData 制限回避)

interface UploadProvider {
    name: string;
    upload: (file: File) => Promise<string>;
}

const uploadToCatbox: UploadProvider = {
    name: 'catbox.moe',
    upload: async (file: File): Promise<string> => {
        const fd = new FormData();
        fd.append('reqtype', 'fileupload');
        fd.append('fileToUpload', file, file.name);

        const res = await fetch('https://catbox.moe/user/api.php', {
            method: 'POST',
            body: fd,
            headers: {
                'User-Agent': 'ORDER-GRIP-DXF-Uploader/1.0',
            },
        });
        if (!res.ok) {
            throw new Error(`catbox.moe: ${res.status} ${res.statusText}`);
        }
        const text = (await res.text()).trim();
        if (!text.startsWith('https://')) {
            throw new Error(`catbox.moe unexpected response: ${text.slice(0, 200)}`);
        }
        return text;
    },
};

const uploadToTmpfiles: UploadProvider = {
    name: 'tmpfiles.org',
    upload: async (file: File): Promise<string> => {
        const fd = new FormData();
        fd.append('file', file, file.name);

        const res = await fetch('https://tmpfiles.org/api/v1/upload', {
            method: 'POST',
            body: fd,
            headers: {
                'User-Agent': 'ORDER-GRIP-DXF-Uploader/1.0',
            },
        });
        if (!res.ok) {
            throw new Error(`tmpfiles.org: ${res.status} ${res.statusText}`);
        }
        const json = (await res.json()) as { status?: string; data?: { url?: string } };
        const raw = json.data?.url;
        if (!raw || typeof raw !== 'string') {
            throw new Error(`tmpfiles.org unexpected response: ${JSON.stringify(json).slice(0, 200)}`);
        }
        // tmpfiles.org は http:// で返すので https:// に補正
        // また、/dl/ にすると直接ダウンロード URL になる
        return raw.replace(/^http:\/\//, 'https://').replace('/tmpfiles.org/', '/tmpfiles.org/dl/');
    },
};

const PROVIDERS = [uploadToCatbox, uploadToTmpfiles];

export async function POST(req: NextRequest): Promise<NextResponse> {
    try {
        const formData = await req.formData();
        const file = formData.get('file');
        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'file field missing' }, { status: 400 });
        }
        if (file.size === 0) {
            return NextResponse.json({ error: 'empty file' }, { status: 400 });
        }
        if (file.size > 10 * 1024 * 1024) {
            return NextResponse.json({ error: 'file too large (>10MB)' }, { status: 413 });
        }

        const errors: string[] = [];
        for (const provider of PROVIDERS) {
            try {
                const url = await provider.upload(file);
                return NextResponse.json({ url, provider: provider.name });
            } catch (err) {
                errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return NextResponse.json(
            { error: `すべてのアップロードプロバイダが失敗しました: ${errors.join(' | ')}` },
            { status: 502 },
        );
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
