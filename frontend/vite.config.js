import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const stripXSpreadsheetLessImport = {
  name: 'strip-x-spreadsheet-less-import',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').endsWith('x-data-spreadsheet/src/index.js')) {
      return null
    }

    return code.replace("import './index.less';", '')
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [stripXSpreadsheetLessImport, react()],
  base: './',// /gitdox2/scriptorium/
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        spannotatorDemo: resolve(__dirname, 'spannotator-demo.html')
      }
    }
  }
})
