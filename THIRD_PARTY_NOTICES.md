# 외부 자산과 라이선스

이 문서는 저장소에 포함된 자산 고지와 출처 기록을 정리합니다. 애플리케이션 소스 전체의 라이선스를 새로 부여하지 않습니다.

| 자산 | 출처·저작자 | 라이선스 | 저장소 내 고지 |
| --- | --- | --- | --- |
| Grass 004 색·노멀·거칠기 텍스처 | ambientCG | CC0 1.0 | [잔디 고지](src/assets/turf/LICENSE.txt) |
| Tree Small 02 모델·텍스처 | Rico Cilliers / Poly Haven | CC0 1.0 | [수목 고지](public/vegetation/external/tree-small-02/LICENSE.txt), [원본 해시와 변환 기록](public/vegetation/external/tree-small-02/provenance.json) |
| 프로젝트 생성 수목 6종·아틀라스·숲 이미지 | 프로젝트 자체 제작 | 기존 자산 고지의 CC0 1.0 | [식생 자산 고지](public/vegetation/LICENSE.txt) |

잔디 맵은 해상도·압축을 조정했습니다. 외부 수목은 원본 기하·UV·노멀을 유지하면서 잎 알파와 재질 설정을 반영해 GLB로 묶었습니다. 파일의 해시와 변환 내용은 위 기록에 있습니다.

공식 자산 출처는 [ambientCG Grass 004](https://ambientcg.com/view?id=Grass004), [Poly Haven Tree Small 02](https://polyhaven.com/a/tree_small_02)입니다. 각 자산의 세부 고지는 원래 `LICENSE.txt`를 유지합니다.

React, Three.js, Vite, TypeScript 및 개발 도구의 라이선스는 각 패키지에 따릅니다. 정확한 버전은 [package-lock.json](package-lock.json)에 고정되어 있으며, 설치된 패키지의 라이선스 파일을 확인할 수 있습니다. 의존성의 라이선스를 자산의 CC0로 해석하지 않습니다.

영상 참고 자료와 내려받은 원본은 로컬 `.references/`에만 보존하며 Git에 포함하지 않습니다. 비교 보고서의 CPU 렌더 이미지에 대해서도 자산 라이선스를 애플리케이션 전체의 라이선스로 확장하지 않습니다.
