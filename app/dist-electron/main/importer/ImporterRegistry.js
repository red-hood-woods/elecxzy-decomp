"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImporterRegistry = void 0;
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
/**
 * Maximum file size allowed for automatic text extraction (default: 50MB).
 * Prevents memory exhaustion in the Main process for excessively large binary files.
 */
const MAX_IMPORT_SIZE = 50 * 1024 * 1024; // 50MB
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.xlsx']);
/**
 * ImporterRegistry: Orchestrates the selection and execution of document text extraction engines.
 * Importers are loaded lazily on first use to avoid loading heavy dependencies (pdf-parse,
 * mammoth, exceljs) at app startup.
 */
exports.ImporterRegistry = {
    /**
     * Identifies the appropriate importer based on file extension and extracts text.
     * Throws an error if the format is not supported or file is too large.
     *
     * @param filePath Path to the file to be imported.
     * @returns Extracted text.
     */
    extractTextFromFile(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            const ext = path_1.default.extname(filePath).toLowerCase();
            if (!SUPPORTED_EXTENSIONS.has(ext)) {
                throw new Error(`Unsupported file format for import: ${ext}`);
            }
            // Performance & Safety Guard: Check file size before attempting extraction
            const stats = yield promises_1.default.stat(filePath);
            if (stats.size > MAX_IMPORT_SIZE) {
                const sizeMB = Math.round(stats.size / (1024 * 1024));
                throw new Error(`File is too large to import (${sizeMB}MB). Limit is ${MAX_IMPORT_SIZE / (1024 * 1024)}MB.`);
            }
            let extract;
            if (ext === '.pdf') {
                const { PdfImporter } = yield import('./PdfImporter.js');
                extract = PdfImporter.extract;
            }
            else if (ext === '.docx') {
                const { WordImporter } = yield import('./WordImporter.js');
                extract = WordImporter.extract;
            }
            else {
                const { ExcelImporter } = yield import('./ExcelImporter.js');
                extract = ExcelImporter.extract;
            }
            return extract(filePath);
        });
    },
    /**
     * Checks if a file extension is supported by the importer.
     *
     * @param filePath Path or filename.
     * @returns True if the extension belongs to a document type handled by this registry.
     */
    isSupported(filePath) {
        const ext = path_1.default.extname(filePath).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext);
    }
};
