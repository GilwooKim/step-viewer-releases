# STEP Viewer iPad 개발 버전

iPad Pro 13인치 M5에서 사용할 앱 프로젝트입니다. Windows 2.8.0의 뷰어와 CAD 편집 코드를 바탕으로 만들었습니다. iPadOS 17 이상을 대상으로 합니다.

아직 TestFlight에 배포한 앱은 아닙니다. Apple Developer Program 가입과 앱 서명이 남아 있습니다. Mac을 바로 구입할 필요는 없으며, 저장소의 GitHub Actions에서 Mac 빌드를 실행할 수 있습니다.

## 조작

- 파일 열기: iPad의 파일 앱에서 하나 또는 여러 파일을 선택합니다.
- 회전: 한 손가락으로 드래그합니다. 두 손가락으로 이동·확대합니다.
- 여러 부품 선택: 위쪽 **다중 선택**을 켠 뒤 모델이나 트리의 부품을 탭합니다. 선택한 부품을 다시 탭하면 선택이 해제됩니다.
- 선택 부품 내보내기: 한 파일 또는 부품별 별도 파일을 선택한 뒤 파일 앱에 저장합니다.
- 세로 화면: **부품** 버튼으로 트리를 열고 닫습니다.
- 설정: 한국어/영어를 변경합니다. 앱 업데이트는 TestFlight/App Store에서 진행합니다.

STEP, STL, OBJ, GLB, 3MF, DXF, USDZ를 읽고 내보내는 경로가 포함되어 있습니다. FBX·DAE·3DS는 읽기만 지원합니다. Windows 전용 변환기를 사용하는 DWG·SKP와 3DM은 이 iPad 개발 버전에 포함하지 않았습니다.

## 대형 파일

100~400MB 파일 사용을 고려하여 4MB 단위로 읽고 256KB 단위로 저장합니다. 원본 STEP 전체를 Base64 문자열로 만들어 네이티브 기능에 전달하지 않습니다. 삼각형 50,000개 때문에 STEP 저장을 막던 제한도 적용하지 않습니다.

파일 크기가 같아도 솔리드·면·곡면 수에 따라 메모리 사용량은 크게 다릅니다. **M5 실기기의 100~400MB 처리 속도와 안정성은 아직 확인하지 못했습니다.** 현재 입력 크기 상한은 512MiB, 여러 탭에 보관하는 STEP 원본의 예산은 600MiB입니다. 큰 파일을 사용할 때는 사용하지 않는 탭을 저장하고 닫아 주세요.

## 다음 배포 단계

1. 앱을 소유할 Apple 계정으로 [Apple Developer Program](https://developer.apple.com/programs/enroll/)에 가입합니다.
2. App Store Connect에서 앱을 등록하고 Bundle ID와 서명 정보를 설정합니다. 임시 Bundle ID는 `com.gilwookim.stepviewer`입니다.
3. GitHub Mac 빌드에 서명 정보를 안전하게 연결하고 TestFlight로 업로드합니다.
4. M5 iPad에서 실제 100MB·200MB·400MB 파일로 열기, 편집, 내보내기, 중단·재실행을 검증합니다.

비밀번호나 인증서 비밀키를 채팅으로 보내지 마세요. 필요한 경우 GitHub Secrets에 등록합니다. 현재 워크플로는 Apple 계정에 접근하거나 앱을 업로드하지 않습니다.

Xcode 프로젝트: `ios/App/App.xcodeproj`. 빌드 방법, 형식별 지원 범위와 제한은 [IPAD.md](IPAD.md)를 참고하세요.
