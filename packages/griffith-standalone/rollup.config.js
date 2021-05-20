import path from 'path'
import babel from '@rollup/plugin-babel'
import resolve from '@rollup/plugin-node-resolve'
import replace from '@rollup/plugin-replace'
import commonjs from '@rollup/plugin-commonjs'
import alias from '@rollup/plugin-alias'
import {terser} from 'rollup-plugin-terser'

const pkg = require(path.resolve(process.cwd(), 'package.json'))

export default [
  {
    input: pkg.source,
    output: [
      {
        file: pkg.main,
        format: 'umd',
        name: 'Griffith',
        sourcemap: false,
      },
    ],
    plugins: [
      babel(require('../../babel.config')),
      commonjs({
        // 不是所有的包都是 ESM（如 React 只是 CJS）
        include: /node_modules/,
      }),
      alias({
        entries: {
          // 如果需要排除插件
          // 'griffith-hls': 'griffith/null',
          // 'griffith-mp4': 'griffith/null',
        },
      }),
      replace({
        preventAssignment: true,
        values: {
          'process.env.NODE_ENV': JSON.stringify('production'),
        },
      }),
      resolve({
        // 有些 npm 包提供了 browser 版本（如 `asap` node 版本使用了 native 模块）
        browser: true,
      }),
      terser(),
    ],
  },
]
