# STEP Viewer

Windows x64용 CAD 뷰어 · 형식 변환 · 기본 솔리드/서페이스 편집 프로그램입니다.

## 다운로드

[최신 버전 설치](https://github.com/GilwooKim/step-viewer-releases/releases/latest)에서 `STEP-Viewer-Setup-<version>-x64.exe`를 실행하세요. Windows 10/11 x64용이며 설치 파일은 코드 서명이 없습니다.

## 자동 업데이트

2.0.1 이하 사용자는 **2.1.0 이상을 한 번 직접 설치**해야 합니다. 이후 프로그램이 실행 중이고 인터넷이 연결되어 있으면 정식 최신 버전을 확인·다운로드합니다. 작업을 저장한 뒤 정상 종료하면 업데이트를 설치합니다. 도움말(F1)에서 진행 상황과 수동 확인, 자동 확인 설정을 사용할 수 있습니다.

저장 중이거나 저장하지 않은 변경 사항이 있으면 종료 보호 절차를 거칩니다. CAD 파일은 로컬에서 처리되고 업로드되지 않습니다. 설치된 사용자에게 GitHub 계정이나 토큰이 필요하지 않습니다.

## 기능

- STEP/STP 열기, 부품 검색·선택·숨기기·단독 보기, 분해도와 나란히 보기
- STEP, STL, OBJ, GLB, FBX, SKP, 3MF, DWG, DXF, 3DS, USDZ, DAE, 3DM 가져오기/내보내기
- 부품 이동·회전·크기·이름·색상, 기본 솔리드/서페이스 연산, 선 드로잉 및 프로젝트 저장

모든 객체를 무손실로 변환하는 프로그램은 아닙니다. 각 형식의 지원 범위와 편집 제한은 소스 ZIP의 README.md에 명시되어 있습니다.

## 소스와 배포

이 저장소는 릴리스 배포용입니다. 각 [릴리스](https://github.com/GilwooKim/step-viewer-releases/releases)에 설치 파일, blockmap, latest.yml, SHA256SUMS.txt와 **STEP-Viewer-Source-<version>.zip**을 함께 제공합니다. 소스 ZIP에는 앱, 네이티브 어댑터, 필요한 상위 라이브러리 소스와 재빌드 안내가 포함됩니다. 사용자 CAD 파일은 포함하지 않습니다.

앱 라이선스: GPL-3.0-only. 상위 라이브러리에는 각각의 라이선스가 적용됩니다. SOURCE-DEPENDENCIES.txt 및 THIRD_PARTY_NOTICES.txt를 참고하세요.

개발자가 다음 버전을 게시하는 절차는 [업데이트 배포 안내](GITHUB-UPDATES.md)를 참고하세요.
