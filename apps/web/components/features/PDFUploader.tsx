'use client';

import { useState, useRef, useEffect } from 'react';

// Extended specs for AI analysis
export interface ExtractedSpecs {
    length?: number;
    maxDiameter?: number;
    weight?: number;
    frontTaperLength?: number;
    rearTaperLength?: number;
    cuts?: {
        type: string;
        startZ: number;
        endZ: number;
        properties?: any;
    }[];
}

interface PDFUploaderProps {
    onApply: (specs: ExtractedSpecs) => void;
}

export const PDFUploader = ({ onApply }: PDFUploaderProps) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [result, setResult] = useState<ExtractedSpecs | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [showApiKeyInput, setShowApiKeyInput] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const aiFileInputRef = useRef<HTMLInputElement>(null); // Separate input for AI mode

    useEffect(() => {
        // Load API key from env or local storage
        const key = process.env.NEXT_PUBLIC_GEMINI_API_KEY || localStorage.getItem('gemini_api_key') || '';
        setApiKey(key);
    }, []);

    const saveApiKey = (key: string) => {
        setApiKey(key);
        localStorage.setItem('gemini_api_key', key);
    };

    const extractUseableText = (text: string): ExtractedSpecs => {
        const specs: ExtractedSpecs = {};

        // Regex patterns for Japanese and English
        const lengthMatch = text.match(/(?:全長|Length)[\s:：]*([0-9.]+(?:\s?mm)?)/i);
        if (lengthMatch) specs.length = parseFloat(lengthMatch[1]);

        const maxDiaMatch = text.match(/(?:最大径|Max\s*Diameter|Max\s*Dia)[\s:：]*([0-9.]+(?:\s?mm)?)/i);
        if (maxDiaMatch) specs.maxDiameter = parseFloat(maxDiaMatch[1]);

        const weightMatch = text.match(/(?:重量|Weight)[\s:：]*([0-9.]+(?:\s?g)?)/i);
        if (weightMatch) specs.weight = parseFloat(weightMatch[1]);

        return specs;
    };

    const runAIAnalysis = async (file: File) => {
        if (!apiKey) {
            alert('AI機能を使用するにはAPIキーが必要です。');
            setShowApiKeyInput(true);
            return;
        }

        setIsProcessing(true);
        setStatus('PDFを画像に変換中...');
        setResult(null);
        setShowPreview(true);

        try {
            const pdfjsLib = await import('pdfjs-dist');
            const { GoogleGenerativeAI } = await import('@google/generative-ai');

            if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
            }

            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            // Render first page to image
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            if (!context) throw new Error('Canvas Context Error');

            const renderContext = { canvasContext: context, viewport: viewport };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.render(renderContext as any).promise;

            const base64Image = canvas.toDataURL('image/jpeg').split(',')[1];

            setStatus('Gemini AIによる図面解析を実行中... (約10-20秒)');

            const genAI = new GoogleGenerativeAI(apiKey);
            // Use specific version if generic tag fails
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

            const prompt = `
                Analyze this dart barrel technical drawing. 
                Extract the specifications and reconstruct the 3D shape parameters.
                Return ONLY a JSON object with this structure (no markdown):
                {
                    "length": number (mm),
                    "maxDiameter": number (mm),
                    "weight": number (g),
                    "frontTaperLength": number (mm, length of the tapering section at the front tip),
                    "rearTaperLength": number (mm, length of the tapering section at the rear shaft side),
                    "cuts": [
                        {
                            "type": string (choose from: "ring", "shark", "wing", "micro", "vertical", "ring_double", "ring_triple", "scallop"),
                            "startZ": number (mm from front tip, 0 is tip),
                            "endZ": number (mm from front tip),
                            "properties": { "depth": number (0.1-1.0), "pitch": number (0.5-2.0) }
                        }
                    ]
                }
                Estimate values visually if not explicitly written. 
                The barrel length is the reference scale.
            `;

            const result = await model.generateContent([
                prompt,
                { inlineData: { data: base64Image, mimeType: "image/jpeg" } }
            ]);

            const responseText = result.response.text();
            console.log("AI Response:", responseText);

            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const specs = JSON.parse(jsonMatch[0]) as ExtractedSpecs;
                setResult(specs);
                setStatus('AI解析完了！');
            } else {
                throw new Error('AIからの応答を解析できませんでした');
            }

        } catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setStatus('エラー: ' + (error as any).message);
            console.error(error);
        } finally {
            setIsProcessing(false);
        }
    };

    const processPDF = async (file: File) => {
        setIsProcessing(true);
        setStatus('PDFを読み込み中...');
        setResult(null);
        setShowPreview(true);

        try {
            // Dynamic imports to avoid SSR/Build issues with pdfjs-dist
            const pdfjsLib = await import('pdfjs-dist');
            const Tesseract = (await import('tesseract.js')).default;

            // Set worker source dynamically to match version
            if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
            }

            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

            let fullText = '';

            // 1. Try extracting text directly (Digital PDF)
            setStatus(`ページ解析中 (1/${pdf.numPages})...`);
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const pageText = textContent.items.map((item: any) => item.str).join(' ');
                fullText += pageText + '\n';
            }

            let specs = extractUseableText(fullText);

            // 2. If text extraction yielded too little, try OCR (Scanned PDF)
            // Heuristic: If we didn't find at least Length or MaxDia, assume it might be an image
            if (!specs.length && !specs.maxDiameter) {
                setStatus('テキストが見つかりません。OCR解析（画像認識）を開始します...');

                // Render first page to canvas for OCR
                const page = await pdf.getPage(1);
                const viewport = page.getViewport({ scale: 2.0 }); // Higher scale for better OCR
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                if (context) {
                    const renderContext = {
                        canvasContext: context,
                        viewport: viewport
                    };
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    await page.render(renderContext as any).promise;
                    const imageData = canvas.toDataURL('image/png');

                    setStatus('OCR解析実行中... (これには数秒かかります)');
                    const { data: { text: ocrText } } = await Tesseract.recognize(
                        imageData,
                        'eng+jpn', // English and Japanese
                    );

                    specs = extractUseableText(ocrText);
                }
            }

            if (Object.keys(specs).length === 0) {
                setStatus('有効なスペック情報が見つかりませんでした。');
            } else {
                setResult(specs);
                setStatus('解析完了！');
            }

        } catch (error) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            setStatus('エラーが発生しました: ' + (error as any).message);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, isAI: boolean) => {
        if (e.target.files && e.target.files[0]) {
            if (isAI) {
                runAIAnalysis(e.target.files[0]);
            } else {
                processPDF(e.target.files[0]);
            }
        }
    };

    return (
        <div className="mb-4">
            <div className="flex gap-2">
                <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className={`flex-1 py-2 bg-zinc-200 dark:bg-zinc-700 text-xs font-bold rounded flex items-center justify-center gap-2 ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}`}
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    OCR読込
                </button>
                <button
                    onClick={() => aiFileInputRef.current?.click()}
                    disabled={isProcessing}
                    className={`flex-1 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white text-xs font-bold rounded flex items-center justify-center gap-2 ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'}`}
                >
                    {isProcessing ? (
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    )}
                    AI図面解析
                </button>
            </div>

            {showApiKeyInput && (
                <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 rounded">
                    <p className="text-[10px] text-yellow-800 dark:text-yellow-200 mb-1">Gemini APIキーを入力してください</p>
                    <div className="flex gap-1">
                        <input
                            type="password"
                            value={apiKey}
                            onChange={(e) => saveApiKey(e.target.value)}
                            className="flex-1 p-1 text-xs border rounded"
                            placeholder="AIza..."
                        />
                        <button onClick={() => setShowApiKeyInput(false)} className="px-2 py-1 bg-zinc-200 rounded text-xs">OK</button>
                    </div>
                </div>
            )}

            <input
                type="file"
                ref={fileInputRef}
                accept=".pdf"
                className="hidden"
                onChange={(e) => handleFileChange(e, false)}
            />
            <input
                type="file"
                ref={aiFileInputRef}
                accept=".pdf"
                className="hidden"
                onChange={(e) => handleFileChange(e, true)}
            />

            {showPreview && (
                <div className="mt-2 p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs shadow-sm">
                    <div className="font-bold mb-2 flex justify-between items-center">
                        <span className="flex items-center gap-2">
                            {isProcessing && (
                                <svg className="animate-spin h-4 w-4 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            )}
                            解析ステータス
                        </span>
                        <button onClick={() => setShowPreview(false)} className="text-zinc-400 hover:text-zinc-600">×</button>
                    </div>
                    <div className={`mb-3 p-2 rounded ${isProcessing ? 'bg-blue-50 text-blue-700' : result ? 'bg-green-50 text-green-700' : 'bg-zinc-100 text-zinc-500'}`}>
                        {status}
                    </div>

                    {result && (
                        <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2 bg-white dark:bg-zinc-900 p-2 rounded border border-zinc-200 dark:border-zinc-700">
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">全長</span>
                                    <span className="font-bold">{result.length ? result.length + 'mm' : '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">最大径</span>
                                    <span className="font-bold">{result.maxDiameter ? result.maxDiameter + 'mm' : '-'}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-zinc-500">重量</span>
                                    <span className="font-bold">{result.weight ? result.weight + 'g' : '-'}</span>
                                </div>
                                <div className="flex justify-between col-span-2">
                                    <span className="text-zinc-500">カット検出数</span>
                                    <span className="font-bold">{result.cuts ? result.cuts.length + '個' : '0個'}</span>
                                </div>
                            </div>

                            <button
                                onClick={() => {
                                    onApply(result);
                                    setShowPreview(false);
                                    setResult(null);
                                    setStatus('');
                                }}
                                className="w-full py-1.5 bg-green-600 text-white font-bold rounded hover:bg-green-700"
                            >
                                このスペックを反映
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
