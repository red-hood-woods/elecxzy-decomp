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
exports.WordImporter = void 0;
const mammoth_1 = __importDefault(require("mammoth"));
/**
 * Importer for extracting text from Word documents (.docx).
 */
exports.WordImporter = {
    /**
     * Extracts text from a Word file asynchronously.
     * @param filePath Absolute path to the .docx file.
     * @returns Extracted plain text.
     */
    extract(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                // mammoth.extractRawText supports path-based extraction and is asynchronous.
                const result = yield mammoth_1.default.extractRawText({ path: filePath });
                if (result.messages.length > 0) {
                    console.warn('[WordImporter] Parse warnings:', result.messages);
                }
                return result.value || '';
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error('[WordImporter] Error:', msg);
                throw new Error(`Failed to parse Word file: ${msg}`);
            }
        });
    }
};
