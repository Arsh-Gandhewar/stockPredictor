import * as vm from 'vm';

if (typeof (vm as any).runInThisContext === 'function') {
  try {
    const rootF32 = (vm as any).runInThisContext('Float32Array');
    const rootF64 = (vm as any).runInThisContext('Float64Array');
    const rootU8 = (vm as any).runInThisContext('Uint8Array');
    const rootI32 = (vm as any).runInThisContext('Int32Array');
    if (rootF32) (global as any).Float32Array = rootF32;
    if (rootF64) (global as any).Float64Array = rootF64;
    if (rootU8) (global as any).Uint8Array = rootU8;
    if (rootI32) (global as any).Int32Array = rootI32;
  } catch {
    // fallback gracefully
  }
}
