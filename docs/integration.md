# 궤적 데이터와 WebView 연동

현재 구현 기준은 [trajectory.ts](../src/core/trajectory.ts), [playback.ts](../src/core/playback.ts), [App.tsx](../src/ui/App.tsx)입니다. 계산 서비스나 장비 SDK는 아직 연결하지 않았습니다.

## JSON 불러오기

화면의 **내 궤적 불러오기**에서 [external-stopped.json](../examples/external-stopped.json)을 선택할 수 있습니다. 파일은 2MiB 이하여야 합니다. 예제는 형식 확인용이며 물리 계산 결과가 아닙니다.

```json
{
  "id": "example-stopped",
  "outcome": "stopped",
  "points": [
    { "x": 0, "z": 0, "t": 0 },
    { "x": 0.18, "z": 2.4, "t": 1 },
    { "x": 0.24, "z": 4.4, "t": 2.5 },
    { "x": 0.12, "z": 5.5, "t": 4.6 }
  ]
}
```

| 필드 | 규칙 |
| --- | --- |
| `id` | 선택 문자열. 생략하면 `external` |
| `outcome` | `holed` 또는 `stopped`. `holed` 이외의 값은 `stopped`로 처리 |
| `points` | 2–10,000개 좌표 |
| `points[].x`, `points[].z` | 필수, 미터 단위 유한 숫자, 각각 절댓값 100 이하 |
| `points[].y` | 선택, 미터 단위 높이, 절댓값 100 이하 |
| `points[].t` | 모든 점에 넣거나 모두 생략. 0 이상의 초 단위 숫자, 엄격한 증가 순서 |
| `duration` | `t`를 생략할 때 필수. 0초 초과 120초 이하 |

`t`가 있으면 재생 시간은 마지막 시간에서 첫 시간을 뺀 값이며 0초 초과 120초 이하여야 합니다. 첫 시간이 0이 아니면 시작 시각만 0으로 옮기고 점 사이의 시간 간격은 보존합니다. 입력의 `duration`은 이 경우 사용하지 않습니다. `t`가 없으면 모든 점을 `duration`에 균등한 시간 간격으로 배치합니다. 구간 사이는 선형 보간합니다.

`x`는 가로 방향, `z`는 출발점에서 홀 쪽 방향이며 홀은 `(0, green.distance)`에 있습니다. 기본 공 반지름은 0.02135m입니다. **`y`는 공 중심이 아닌 공 밑면 기준 높이**이며 렌더러가 반지름을 더합니다. 높이를 제공하려면 모든 점에 일관되게 넣습니다. 한 구간의 두 점 모두에 `y`가 있어야 그 구간의 높이를 보간합니다.

`y`를 생략하면 표시 그린의 높이를 사용합니다.

```text
height = x × crossSlope / 100 + z × longitudinalSlope / 100
```

양의 좌우 경사는 `+x` 방향이 높고, 양의 앞뒤 경사는 홀 방향이 높은 오르막입니다. 이 식은 화면의 평면 높이이며 물리 계산식이 아닙니다.

외부 궤적의 경로와 시간은 설정을 바꿔도 자동 재계산하지 않습니다. `holed`이고 마지막 점의 `z`가 2–12m, `|x| < 0.2m`이면 화면의 홀 거리를 마지막 `z`로 맞춥니다. 홀과 가깝다는 이유만으로 성공 판정을 만들지 않으며 입력 `outcome`을 사용합니다. `y` 없는 홀인 궤적에는 홀 근처에서 시각적인 하강 연출이 적용됩니다.

## 호스트 → 화면

React Native에서는 WebView 참조의 `postMessage`로 JSON 문자열을 전달합니다.

```ts
webViewRef.current?.postMessage(JSON.stringify({
  type: 'putting:set-trajectory',
  payload: trajectoryData,
}));

webViewRef.current?.postMessage(JSON.stringify({ type: 'putting:pause' }));
```

화면은 `window`와 Android 호환용 `document`의 `message` 이벤트를 모두 받습니다. `putting:set-trajectory`는 데이터만 불러오며 자동 재생하지 않습니다. 현재 호스트 수신 명령은 위 두 가지이고 재생·카메라·그린 설정용 메시지는 구현하지 않았습니다.

같은 페이지의 브라우저 콘솔에서 확인할 때는 다음 형태를 사용할 수 있습니다.

```js
window.postMessage({
  type: 'putting:set-trajectory',
  payload: trajectoryData,
}, window.location.origin);
```

현재 수신부는 메시지의 발신 origin을 검증하지 않습니다. 외부 사이트 iframe 연동을 추가할 때는 신뢰할 발신자 검증도 구현해야 합니다.

## 화면 → 호스트

`window.ReactNativeWebView.postMessage`가 있으면 `{ type, payload }` JSON 문자열을 보냅니다. React Native WebView의 `onMessage`에서 `event.nativeEvent.data`를 파싱합니다.

| `type` | `payload` | 발생 시점 |
| --- | --- | --- |
| `putting:ready` | `{ version: 1 }` | 씬 준비 완료 |
| `putting:settings` | `{ distance, stimp, crossSlope, longitudinalSlope }` | 사용자가 그린 설정 변경 |
| `putting:complete` | `{ id, outcome, remaining, duration }` | 재생 완료 |

`remaining`은 마지막 좌표와 홀 사이의 수평 거리(m)이며 `holed`이면 0입니다. `duration`은 재생 배속 적용 전 궤적 길이(초)입니다. 일시정지나 탐색만으로 완료 이벤트를 보내지 않습니다.

일반 웹 페이지는 설정 변경 시 발생하는 별도의 `putting:request-trajectory` 이벤트를 받을 수 있습니다. 계산 결과를 `putting:set-trajectory`로 돌려주는 부분은 호스트에서 구현합니다.

```js
window.addEventListener('putting:request-trajectory', (event) => {
  const greenSettings = event.detail;
  // 실제 계산기에 설정을 전달하고, 반환된 좌표와 시간을 그대로 사용합니다.
});
```
