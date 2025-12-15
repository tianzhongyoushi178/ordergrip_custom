'use client';

import { useState, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import Tesseract from 'tesseract.js';

// Initialize PDF.js worker
// Using CDN for worker to avoid build complexity with Next.js/Webpack
if (typeof window !== 'undefined' && 'Worker' in window) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.8.69/pdf.worker.min.mjs`;
}

interface ExtractedSpecs {
    length?: number;
    maxDiameter?: number;
    weight?: number;
}

interface PDFUploaderProps {
    onApply: (specs: ExtractedSpecs) => void;
}

export const PDFUploader = ({ onApply }: PDFUploaderProps) => {
    const [isProcessing, setIsProcessing] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [result, setResult] = useState<ExtractedSpecs | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const extractUseableText = (text: string): ExtractedSpecs => {
        const specs: ExtractedSpecs = {};

        // Regex patterns for Japanese and English
        // Length: 全長, Length
        const lengthMatch = text.match(/(?:全長|Length)[\s:：]*([0-9.]+(?:\s?mm)?)/i);
        if (lengthMatch) {
            specs.length = parseFloat(lengthMatch[1]);
        }

        // Max Diameter: 最大径, Max Dia
        const maxDiaMatch = text.match(/(?:最大径|Max\s*Diameter|Max\s*Dia)[\s:：]*([0-9.]+(?:\s?mm)?)/i);
        if (maxDiaMatch) {
            specs.maxDiameter = parseFloat(maxDiaMatch[1]);
        }

        // Weight: 重量, Weight
        const weightMatch = text.match(/(?:重量|Weight)[\s:：]*([0-9.]+(?:\s?g)?)/i);
        if (weightMatch) {
            specs.weight = parseFloat(weightMatch[1]);
        }

        return specs;
    };

    const processPDF = async (file: File) => {
        setIsProcessing(true);
        setStatus('PDFを読み込み中...');
        setResult(null);
        setShowPreview(true);

        try {
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
                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                    const imageData = canvas.toDataURL('image/png');

                    setStatus('OCR解析実行中... (これには数秒かかります)');
                    const { data: { text: ocrText } } = await Tesseract.recognize(
                        imageData,
                        'eng+jpn', // English and Japanese
                        { logger: m => console.log(m) }
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

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            processPDF(e.target.files[0]);
        }
    };

    return (
        <div className="mb-4">

            <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-xs font-bold rounded hover:opacity-90 flex items-center justify-center gap-2"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg>
                PDFからスペック読込
            </button>
            <input
                type="file"
                ref={fileInputRef}
                accept=".pdf"
                className="hidden"
                onChange={handleFileChange}
            />

            {showPreview && (
                <div className="mt-2 p-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs">
                    <div className="font-bold mb-2 flex justify-between">
                        <span>解析ステータス</span>
                        <button onClick={() => setShowPreview(false)} className="text-zinc-400 hover:text-zinc-600">×</button>
                    </div>
                    <div className="text-zinc-500 mb-2">{status}</div>

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
