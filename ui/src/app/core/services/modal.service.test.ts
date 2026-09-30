import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ModalService } from './modal.service';

describe('ModalService', () => {
  it('open sets modal config; close clears it', () => {
    const svc = new ModalService();
    assert.equal(svc.modal(), null);

    svc.open({
      titleKey: 'account.ms.help.title',
      confirmKey: 'modal.close',
      sections: [{ titleKey: 'a', bodyKey: 'b' }],
    });

    const open = svc.modal();
    assert.ok(open);
    assert.equal(open!.titleKey, 'account.ms.help.title');
    assert.equal(open!.sections?.length, 1);

    svc.close();
    assert.equal(svc.modal(), null);
  });

  it('bodyKey is optional; icon and cancelKey accepted', () => {
    const svc = new ModalService();
    svc.open({
      titleKey: 'account.security.help.title',
      icon: 'security',
      cancelKey: 'modal.close',
    });
    const m = svc.modal();
    assert.ok(m);
    assert.equal(m!.bodyKey, undefined);
    assert.equal(m!.icon, 'security');
    svc.close();
  });

  it('onConfirm and confirmVariant are stored on config', () => {
    const svc = new ModalService();
    let called = false;
    svc.open({
      titleKey: 'install.uninstall.confirm.title',
      confirmKey: 'install.uninstall.confirm.action',
      confirmVariant: 'danger',
      onConfirm: () => {
        called = true;
      },
    });
    const m = svc.modal();
    assert.ok(m);
    assert.equal(m!.confirmVariant, 'danger');
    void m!.onConfirm?.();
    assert.equal(called, true);
    svc.close();
  });
});
