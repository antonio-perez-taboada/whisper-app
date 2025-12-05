import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sizes = [192, 512];

async function generateIcons() {
  const svgPath = join(__dirname, '../public/icon.svg');
  const svgBuffer = readFileSync(svgPath);

  for (const size of sizes) {
    const outputPath = join(__dirname, `../public/icon-${size}.png`);

    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);

    console.log(`✓ Generated icon-${size}.png`);
  }

  console.log('\n✨ All icons generated successfully!');
}

generateIcons().catch(console.error);
