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
exports.ExcelImporter = void 0;
const exceljs_1 = __importDefault(require("exceljs"));
/**
 * Importer for extracting text from Excel files (.xlsx).
 * Iterates through all sheets and converts data to TSV format.
 * Note: Legacy .xls format is no longer supported due to security library migration.
 */
exports.ExcelImporter = {
    /**
     * Extracts text from an Excel file asynchronously using exceljs.
     * Inserts sheet names as headers and exports data in Tab-Separated Values (TSV) format.
     * @param filePath Absolute path to the Excel file.
     * @returns Extracted plain text.
     */
    extract(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const workbook = new exceljs_1.default.Workbook();
                yield workbook.xlsx.readFile(filePath);
                let fullText = '';
                workbook.eachSheet((worksheet) => {
                    // Mark the sheet boundary clearly
                    fullText += `--- Sheet: ${worksheet.name} ---\n`;
                    worksheet.eachRow({ includeEmpty: true }, (row) => {
                        var _a, _b;
                        const rowValues = [];
                        // Row values are 1-indexed in exceljs. We iterate precisely up to the last column.
                        const maxColumn = worksheet.columnCount;
                        for (let i = 1; i <= maxColumn; i++) {
                            const cell = row.getCell(i);
                            let val = '';
                            if (cell && cell.value !== null && cell.value !== undefined) {
                                const value = cell.value;
                                if (typeof value === 'object') {
                                    // Handle cases like RichText, Formula results, or Hyperlinks
                                    if ('result' in value) {
                                        val = String((_a = value.result) !== null && _a !== void 0 ? _a : '');
                                    }
                                    else if ('richText' in value) {
                                        val = value.richText.map(rt => rt.text).join('');
                                    }
                                    else if ('text' in value) {
                                        val = String((_b = value.text) !== null && _b !== void 0 ? _b : '');
                                    }
                                    else {
                                        val = JSON.stringify(value);
                                    }
                                }
                                else {
                                    val = String(value);
                                }
                            }
                            rowValues.push(val);
                        }
                        fullText += rowValues.join('\t') + '\n';
                    });
                    fullText += '\n\n';
                });
                return fullText.trim();
            }
            catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.error('[ExcelImporter] Error:', msg);
                throw new Error(`Failed to parse Excel file: ${msg}`);
            }
        });
    }
};
