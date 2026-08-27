import { Logger } from '../src/logging/logger.js';

describe('STDOUT Protocol Protection Suite', () => {
  let stdoutWriteSpy: jest.SpyInstance;
  let stderrWriteSpy: jest.SpyInstance;

  beforeAll(() => {
    // Install stdout protector
    Logger.protectStdout();
  });

  beforeEach(() => {
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrWriteSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    stderrWriteSpy.mockRestore();
  });

  it('redirects console.log to stderr and NEVER writes to stdout', () => {
    console.log('Unintentional diagnostic log from third-party library');

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(stderrWriteSpy).toHaveBeenCalled();
    const loggedOutput = stderrWriteSpy.mock.calls[0][0];
    expect(loggedOutput).toContain('[REDIRECTED-LOG]');
    expect(loggedOutput).toContain('Unintentional diagnostic log from third-party library');
  });

  it('redirects console.info to stderr and NEVER writes to stdout', () => {
    console.info('Startup banner version 1.0.0');

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(stderrWriteSpy).toHaveBeenCalled();
    const loggedOutput = stderrWriteSpy.mock.calls[0][0];
    expect(loggedOutput).toContain('[REDIRECTED-INFO]');
  });

  it('redirects console.debug and console.warn to stderr and NEVER writes to stdout', () => {
    console.debug('Debugging query params');
    console.warn('Deprecated method used');

    expect(stdoutWriteSpy).not.toHaveBeenCalled();
    expect(stderrWriteSpy).toHaveBeenCalledTimes(2);
  });
});
