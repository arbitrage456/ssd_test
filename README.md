# SSD I/O 성능 테스트 스크립트 (README)

이 프로젝트는 **SSD**의 다양한 I/O 성능을 **Node.js** 환경에서 테스트하기 위한 예시 스크립트입니다.  
소규모/대규모 파일 **I/O**, **DB(읽기/쓰기)**, **압축** 등을 다양한 시나리오로 구성하였으며,  
각 스텝(1~12)별로 **실행 시간을 측정**하여 SSD 성능을 파악할 수 있습니다.

---

## 1. 스텝 개요 (한눈에 보기)

| 스텝  | 요약                                                         | 샘플 테스트 시간(초) |
|:----:|:-------------------------------------------------------------|---------------------:|
| **Step1**  | 작은 CSV 파일에 5만 번 append (3회 반복)                               | 1.533               |
| **Step2**  | 작은 파일 1000개에 동시 쓰기 (각 300회)                                  | 1.111               |
| **Step3**  | Step2에서 만든 1000개 파일을 100번 반복 읽기                            | 0.580                |
| **Step4**  | 대용량(1GB) CSV 파일 250개 생성 (스트리밍)                              | 124.167              |
| **Step5**  | Step4에서 만든 대용량 CSV 파일(250개) 전부 읽기 (스트리밍)              | 28.718               |
| **Step6**  | 대용량 CSV 10개를 각각 다른 DB 파일에 저장 (1MB씩 BLOB insert)           | 147.211               |
| **Step7**  | Step6에서 만든 DB 파일들, 여러 번(100회) 읽기                           | 0.173                |
| **Step8**  | DB 랜덤 레코드 조회 (100회)                                            | 0.202                |
| **Step9**  | 용량이 찬 상태에서 Step1 로직(소규모 쓰기) 재테스트 (3회 반복)           | 1.516               |
| **Step10** | 용량이 찬 상태에서 Step2 로직(동시 쓰기) 재테스트                        | 1.072                |
| **Step11** | 2·4·6번에서 만든 파일 일부(또는 전체)를 ZIP 압축 (archiver 사용)         | 31.071               |
| **Step12** | 모든 테스트 데이터 삭제 (test_data 폴더 통째로 제거)                    | 0.552                |

> **테스트 환경 예시**  
> - 운영체제: **Windows**  
> - SSD: **T700 (PCIe 5.0, 1TB)**  
> - 위 표에 적힌 시간은 실제 예시 결과이며, **환경·설정**에 따라 달라질 수 있습니다.

---

## 2. 프로젝트 개요

- **목적**:  
  다양한 I/O 패턴(소규모/대규모, 동시성, DB BLOB, 압축 등)을 통해 **SSD 성능**을 측정하고 비교하기 위함.

- **주요 특징**:
  1. **Node.js** 기반 (v14 이상 권장)  
  2. **스트리밍** 방식 도입으로 대용량 파일을 다룰 때 메모리 부담 감소  
  3. **SQLite**를 이용해 DB I/O (BLOB) 테스트  
  4. **`archiver`** 라이브러리를 사용해 **ZIP** 압축  
  5. 선택적으로 **7z CLI**를 설치해 7z 포맷으로 압축 가능

---

## 3. 설치 및 실행 방법

1. **Node.js** 설치 (v14 이상 권장)  
2. **npm 패키지** 설치  
   ```bash
   npm install fs-extra archiver sqlite3
