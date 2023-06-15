import { expect, test } from '@oclif/test';

describe('hg create dev', () => {
  test
    .stdout()
    .command(['hg create dev'])
    .it('runs hello', (ctx) => {
      expect(ctx.stdout).to.contain('hello world');
    });

  test
    .stdout()
    .command(['hg create dev', '--name', 'Astro'])
    .it('runs hello --name Astro', (ctx) => {
      expect(ctx.stdout).to.contain('hello Astro');
    });
});
