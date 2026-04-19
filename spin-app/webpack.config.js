import path from 'path';
import webpack from 'webpack';
import SpinSdkPlugin from "@spinframework/build-tools/plugins/webpack/index.js";
import { readFileSync, existsSync } from 'fs';

// Lê .env do diretório pai (raiz do projeto)
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '../.env');
  if (!existsSync(envPath)) return {};
  return Object.fromEntries(
    readFileSync(envPath, 'utf8')
      .split('\n')
      .filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => { const [k, ...v] = l.split('='); return [k.trim(), v.join('=').trim()]; })
  );
}

const config = async () => {
  const env = loadEnv();
  let SpinPlugin = await SpinSdkPlugin.init();
  return {
    mode: 'production',
    stats: 'errors-only',
    entry: './src/index.ts',
    experiments: { outputModule: true },
    module: {
      rules: [{ test: /\.tsx?$/, use: 'ts-loader', exclude: /node_modules/ }],
    },
    resolve: { extensions: ['.tsx', '.ts', '.js'] },
    output: {
      path: path.resolve(process.cwd(), './build'),
      filename: 'bundle.js',
      module: true,
      library: { type: "module" },
    },
    plugins: [
      SpinPlugin,
      new webpack.DefinePlugin({
        '__HARPER_URL__': JSON.stringify(process.env.HARPER_URL ?? env.HARPER_URL ?? ''),
        '__HARPER_USER__': JSON.stringify(process.env.HARPER_USER ?? env.HARPER_USER ?? ''),
        '__HARPER_PASS__': JSON.stringify(process.env.HARPER_PASS ?? ''),
      }),
    ],
    optimization: { minimize: false },
    performance: { hints: false },
  };
};
export default config;
