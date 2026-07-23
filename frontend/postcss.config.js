import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

const stripFirefoxInvalidTextSizeAdjust = {
  postcssPlugin: 'strip-firefox-invalid-text-size-adjust',
  Declaration(decl) {
    if (decl.prop === '-webkit-text-size-adjust' && decl.value.trim() === '100%') {
      decl.remove()
    }
  },
}

export default {
  plugins: [tailwindcss(), autoprefixer(), stripFirefoxInvalidTextSizeAdjust],
}
