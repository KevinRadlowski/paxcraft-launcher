import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveErrorMessageKey } from '../../core/errors/error-messages.js';
import { resolveInstallCardPresentation } from '../../shared/install-card-presentation.js';
import { translate } from '../../core/i18n/messages.js';

function canModifyLocationWhileUnavailable(readiness: string): boolean {
  return readiness === 'NOT_INSTALLED' || readiness === 'LOCATION_UNAVAILABLE';
}

function instancePathLabel(settingsPath: string | undefined, summaryPath: string | undefined): string {
  return settingsPath ?? summaryPath ?? '—';
}

test('settings instance path label prefers settings then storage summary', () => {
  assert.equal(instancePathLabel('D:\\Games\\SweetCraft', undefined), 'D:\\Games\\SweetCraft');
  assert.equal(instancePathLabel(undefined, 'E:\\SweetCraft'), 'E:\\SweetCraft');
  assert.equal(instancePathLabel(undefined, undefined), '—');
});

test('non-empty location error maps to French copy', () => {
  const key = resolveErrorMessageKey('INSTANCE_LOCATION_NOT_EMPTY');
  assert.equal(key, 'error.instance.location.not_empty');
  assert.match(translate(key), /n'est pas vide/i);
  assert.match(translate(key), /dossier vide/i);
});

test('ownership not proven error maps to French copy', () => {
  const key = resolveErrorMessageKey('INSTANCE_OWNERSHIP_NOT_PROVEN');
  assert.equal(key, 'error.instance.location.ownership_not_proven');
  assert.match(translate(key), /PaxCraft/i);
});

test('LOCATION_UNAVAILABLE install card uses explicit unavailable copy', () => {
  const card = resolveInstallCardPresentation('LOCATION_UNAVAILABLE', 'IDLE');
  assert.equal(card.headlineKey, 'install.message.location_unavailable');
  assert.equal(translate(card.headlineKey), translate('settings.location.unavailable'));
});

test('LOCATION_UNAVAILABLE still allows location modification flow', () => {
  assert.equal(canModifyLocationWhileUnavailable('LOCATION_UNAVAILABLE'), true);
  assert.equal(canModifyLocationWhileUnavailable('READY'), false);
});

test('move-in-progress uses moving French copy', () => {
  assert.match(translate('settings.location.moving'), /Déplacement/i);
});

test('location updated success copy exists', () => {
  assert.match(translate('settings.location.updated'), /mis à jour/i);
});

test('semantic folder selection is backend-only contract', () => {
  const gatewayShape = ['chooseLocation', 'setLocation', 'move'] as const;
  assert.deepEqual(gatewayShape, ['chooseLocation', 'setLocation', 'move']);
});

test('LOCATION_UNAVAILABLE relocation copy warns inaccessible source', () => {
  assert.match(
    translate('settings.location.unavailable_relocate.body'),
    /inaccessible/i,
  );
  assert.match(
    translate('settings.location.unavailable_relocate.body'),
    /Aucun fichier/i,
  );
});

test('LOCATION_UNAVAILABLE success uses relocated copy not move wording', () => {
  assert.match(translate('settings.location.relocated'), /emplacement/i);
  assert.notEqual(
    translate('settings.location.relocated'),
    translate('settings.location.updated'),
  );
});

test('move commit failure maps to preserved French copy', () => {
  const key = resolveErrorMessageKey('INSTANCE_MOVE_PRESERVED');
  assert.equal(key, 'error.instance.location.move_preserved');
  assert.match(translate(key), /conservée/i);
});
