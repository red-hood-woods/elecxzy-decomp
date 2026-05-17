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
exports.PdfImporter = void 0;
const promises_1 = __importDefault(require("fs/promises"));
const pdf_parse_1 = require("pdf-parse");
/**
 * Importer for extracting text from PDF files.
 */
exports.PdfImporter = {
    /**
     * Extracts text from a PDF file asynchronously.
     * @param filePath Absolute path to the PDF file.
     * @returns Extracted plain text.
     */
    extract(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // Use asynchronous readFile to avoid blocking the Main process event loop.
                const dataBuffer = yield promises_1.default.readFile(filePath);
                const parser = new pdf_parse_1.PDFParse({ data: dataBuffer });
                const data = yield parser.getText();
                return data.text || '';
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error('[PdfImporter] Error:', msg);
                throw new Error(`Failed to parse PDF file: ${msg}`);
            }
        });
    }
};
