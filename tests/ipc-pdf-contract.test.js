const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..')
const read = (...segments) => fs.readFileSync(path.join(repoRoot, ...segments), 'utf8')

test('PDF export IPC stays aligned across channel, preload, shared contract, and renderer wrapper', () => {
  const channels = read('electron', 'ipc', 'channels.ts')
  const preload = read('preload', 'index.ts')
  const sharedContracts = read('src', 'shared', 'ipc-contracts.ts')
  const rendererApi = read('src', 'lib', 'electron-api.ts')

  assert.match(channels, /EXPORT_PDF:\s*'file:export-pdf'/)
  assert.match(preload, /FileExportPdfRequest/)
  assert.match(preload, /exportPdf:\s*\(payload:\s*FileExportPdfRequest\)/)
  assert.match(preload, /IPC_CHANNELS\.FILES\.EXPORT_PDF/)

  assert.match(
    sharedContracts,
    /export type FileExportPdfRequest = \{[\s\S]*html\?:\s*string;?[\s\S]*company\?:\s*string;?[\s\S]*decisionMakers\?:\s*Array<Record<string, unknown>>;?[\s\S]*\};?/,
  )
  assert.match(
    sharedContracts,
    /export type FileExportPdfData = \{[\s\S]*filePath\?:\s*string;?[\s\S]*canceled\?:\s*boolean;?[\s\S]*trialRemaining\?:\s*number;?[\s\S]*\};?/,
  )
  assert.match(
    sharedContracts,
    /exportPdf:\s*\(payload:\s*FileExportPdfRequest\)\s*=>\s*Promise<IpcResponse<FileExportPdfData>>/,
  )

  assert.match(
    rendererApi,
    /export const exportPdfFile = async \(payload:\s*FileExportPdfRequest\):\s*Promise<FileExportPdfData>/,
  )
  assert.match(rendererApi, /window\.electronAPI\.files\.exportPdf\(payload\)/)
  assert.match(rendererApi, /PDF 导出失败/)
})
