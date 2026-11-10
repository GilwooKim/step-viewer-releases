import {openSettings} from './settings.js';
export function initUpdates() {
  const $ = id => document.getElementById(id);
  let lastStatus;
  function render(state) {
    $('app-version').textContent = state.currentVersion;
    $('update-version').textContent = `설치된 버전 ${state.currentVersion}`;
    const text = {
      unconfigured: '개발 실행에서는 자동 업데이트가 꺼져 있습니다. 배포용 설치 프로그램에서 사용할 수 있습니다.',
      idle: 'GitHub Releases에서 새 버전을 확인합니다.', checking: '새 버전을 확인하고 있습니다…',
      current: '현재 최신 버전을 사용하고 있습니다.', available: `${state.version} 버전을 다운로드할 수 있습니다.`,
      downloading: `${state.version} 다운로드 중 · ${state.percent}%`,
      downloaded: `${state.version} 업데이트 준비 완료. 작업을 저장한 뒤 프로그램을 종료하면 설치됩니다.`,
      error: state.error === 'verification' ? '업데이트 파일을 검증하지 못했습니다. 다시 확인해 주세요.' : '업데이트 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'
    };
    $('update-status').textContent = text[state.status] || '';
    $('update-auto').checked = state.automatic;
    $('update-check').disabled = !state.configured || ['checking', 'downloading', 'downloaded'].includes(state.status);
    $('update-download').hidden = state.status !== 'available';
    $('update-install').hidden = state.status !== 'downloaded';
    $('update-progress').hidden = state.status !== 'downloading';
    $('update-progress').value = state.percent;
    $('update-banner').hidden = state.status !== 'downloaded';
    if (state.status === 'downloaded' && lastStatus !== 'downloaded') $('update-banner-text').textContent = `${state.version} 업데이트 준비 완료 · 작업 저장 후 종료 시 설치`;
    lastStatus = state.status;
  }
  async function perform(fn) { try { render(await fn()); } catch { $('update-status').textContent = '설정을 저장하거나 업데이트를 처리하지 못했습니다. 다시 시도해 주세요.'; } }
  $('update-check').onclick = () => perform(() => window.desktop.checkUpdates());
  $('update-download').onclick = () => perform(() => window.desktop.downloadUpdate());
  $('update-auto').onchange = () => perform(() => window.desktop.setAutomaticUpdates($('update-auto').checked));
  $('update-install').onclick = async () => {
    try { const result = await window.desktop.installUpdate();
      if (result?.error) $('update-status').textContent = result.error;
    } catch { $('update-status').textContent = '설정을 저장하거나 업데이트를 처리하지 못했습니다. 다시 시도해 주세요.'; }
  };
  $('update-banner').onclick = () => { openSettings(); $('update-settings').scrollIntoView({ block: 'nearest' }); };
  window.desktop.onUpdateState(render);
  void perform(() => window.desktop.updateState());
}
