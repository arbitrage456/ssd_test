/**
 * SSD I/O 성능 테스트 스크립트
 * node test-ssd.js
 */

const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const { performance } = require('perf_hooks');

// DB 사용 예시용 (SQLite)
const sqlite3 = require('sqlite3').verbose();

// =========================================================
// 설정값 (필요에 맞게 조정)
// =========================================================
const SMALL_CSV_SINGLE_FILE = path.join(__dirname, 'test_data', 'step1_single.csv');
const SMALL_FILES_DIR = path.join(__dirname, 'test_data', 'step2_smallfiles');
const SMALL_FILES_COUNT = 1000;
const SMALL_WRITES_PER_FILE = 300;

const SMALL_READ_FILES_DIR = SMALL_FILES_DIR;  // 3번에서 재사용

const LARGE_CSV_DIR = path.join(__dirname, 'test_data', 'step4_large_csv');
const LARGE_CSV_COUNT = 400; // 1GB 파일 100개
const LARGE_CSV_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB

const DB_DIR = path.join(__dirname, 'test_data', 'step6_db');
const DB_FILE = path.join(DB_DIR, 'test.sqlite');

const COMPRESSION_OUTPUT_DIR = path.join(__dirname, 'test_data', 'compressed');

// 9번에서 용량이 찬 상태(= 1~8번 수행 후) 재테스트 시 재사용 (1,2번)
const STEP9_REPEAT_TIMES = { 
  // 실제로는 1,2번과 같은 로직을 반복
  step1Count: 50000,
  step2FileCount: 1000,
  step2WritesPerFile: 50
};

const results = {}; // 각 단계별 시간 기록



// 예시: archiver로 ZIP 압축
const archiver = require('archiver');

/**
 * 주어진 sourceDir(디렉토리)을 ZIP으로 압축하여 outZip 경로에 저장
 */
async function compressWithZip(sourceDir, outZip) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outZip);
    // zlib 압축 레벨(level: 0~9) 조정 가능
    const archive = archiver('zip', { zlib: { level: 9 } });

    // 스트림 연결
    archive.pipe(output);

    // 이벤트 핸들러
    output.on('close', () => {
      // archive.pointer()로 최종 바이트 수를 알 수 있음
      console.log(`압축 완료: ${outZip} (${archive.pointer()} bytes)`);
      resolve();
    });
    output.on('end', () => {
      // console.log('Data has been drained');
    });
    archive.on('warning', (err) => {
      // ENOENT 등 단순 경고는 진행 가능
      if (err.code === 'ENOENT') {
        console.warn('압축 과정 경고:', err);
      } else {
        reject(err);
      }
    });
    archive.on('error', (err) => {
      reject(err);
    });

    // 실제로 디렉토리를 압축에 추가
    archive.directory(sourceDir, false);
    // 압축 마무리
    archive.finalize();
  });
}





// =========================================================
// 유틸 함수
// =========================================================

/**
 * 특정 비동기 함수를 실행하고, 소요 시간을 기록하는 래퍼 함수
 */
async function measureAsync(stepName, fn) {
  console.log(`\n===== [${stepName}] 시작 =====`);
  const start = performance.now();
  await fn();
  const end = performance.now();
  const duration = (end - start) / 1000; // 초 단위
  results[stepName] = duration;
  console.log(`===== [${stepName}] 완료: ${duration.toFixed(3)}초 =====`);
}

/**
 * 특정 크기(바이트)의 임시 데이터를 생성(문자열 or 버퍼)
 * 실제 1GB 메모리에 올리는 건 부담되므로, 보통 스트리밍 방식을 쓰지만
 * 여기서는 단순 샘플이므로 chunk를 반복해서 쓰는 식으로 구현 가능
 */
function generateData(sizeInBytes) {
  // 예: 1KB 짜리 문자열 하나를 만들어서 반복 사용
  const chunk = 'X'.repeat(1024); 
  const chunkCount = Math.floor(sizeInBytes / 1024);
  let result = '';
  for (let i = 0; i < chunkCount; i++) {
    result += chunk;
  }
  // sizeInBytes가 1024로 나누어떨어지지 않을 경우 추가
  const remainder = sizeInBytes % 1024;
  if (remainder > 0) {
    result += 'X'.repeat(remainder);
  }
  return result;
}

/**
 * 7z 압축을 수행하는 함수 (child_process spawn 사용)
 * @param {string} sourcePath 압축할 파일/디렉토리 경로
 * @param {string} outPath 결과 .7z 파일 경로
 */
async function compressWith7z(sourcePath, outPath) {
  return new Promise((resolve, reject) => {
    // 예: 7z a -t7z output.7z source
    const proc = spawn('7z', ['a', '-t7z', outPath, sourcePath], { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`7z process exited with code ${code}`));
      }
    });
  });
}

// =========================================================
// 단계별 구현
// =========================================================

// 1. csv await fs.append (같은 파일에 5만번 append, 5번 평균) - 간단 버전
async function step1() {
  const iteration = 3;
  let totalDuration = 0;

  // 디렉토리 준비
  await fs.ensureDir(path.dirname(SMALL_CSV_SINGLE_FILE));

  for (let run = 1; run <= iteration; run++) {
    // 기존 파일 삭제
    if (await fs.pathExists(SMALL_CSV_SINGLE_FILE)) {
      await fs.unlink(SMALL_CSV_SINGLE_FILE);
    }

    // 헤더 추가
    const header = 'id,value\n';
    await fs.appendFile(SMALL_CSV_SINGLE_FILE, header);

    const startTime = performance.now();
    for (let i = 1; i <= 50000; i++) {
      const row = `${i},value_${i}\n`;
      await fs.appendFile(SMALL_CSV_SINGLE_FILE, row);
    }
    const endTime = performance.now();
    totalDuration += (endTime - startTime);
  }

  const avgMs = totalDuration / iteration;
  console.log(`Step1 Average Time (3 runs): ${(avgMs / 1000).toFixed(3)}초`);
}

// 2. csv await fs.append (서로 다른 파일 1000개에 동시 각각 50번 씩 쓰기)
async function step2() {
  await fs.ensureDir(SMALL_FILES_DIR);

  // 파일 1000개 생성 -> 각 파일에 50번씩 append를 병렬로 진행
  const fileWritePromises = [];
  for (let i = 0; i < SMALL_FILES_COUNT; i++) {
    const fileName = `small_${i}.csv`;
    const filePath = path.join(SMALL_FILES_DIR, fileName);

    // 하나의 파일에 대한 50번 append 작업
    fileWritePromises.push((async () => {
      // 파일 초기화 (기존에 있으면 삭제)
      if (await fs.pathExists(filePath)) {
        await fs.unlink(filePath);
      }
      await fs.appendFile(filePath, 'id,value\n');
      for (let j = 1; j <= SMALL_WRITES_PER_FILE; j++) {
        const row = `${j},value_${j}\n`;
        await fs.appendFile(filePath, row);
      }
    })());
  }

  // 모든 파일의 append가 끝날 때까지 대기
  await Promise.all(fileWritePromises);
}

// 3. 서로 다른 파일 1000개 파일 읽기 (동시에?) - 총 100번 반복
async function step3() {
    for (let round = 1; round <= 100; round++) {
    //   console.log(`Step3 - Round ${round} / 100 시작`);
      
      const fileReadPromises = [];
      for (let i = 0; i < SMALL_FILES_COUNT; i++) {
        const fileName = `small_${i}.csv`;
        const filePath = path.join(SMALL_READ_FILES_DIR, fileName);
        fileReadPromises.push(fs.readFile(filePath, 'utf-8'));
      }
  
      // 병렬로 읽기
      await Promise.all(fileReadPromises);
  
    //   console.log(`Step3 - Round ${round} / 100 완료`);
    }
  }
  

// 4. 대용량 csv 파일 만들기 (1기가 파일 100개 동시에) - 스트리밍 방식
async function step4() {
    await fs.ensureDir(LARGE_CSV_DIR);
  
    // 실제 1GB로 테스트 시
    const realSizeBytes = LARGE_CSV_SIZE_BYTES; // 1GB = 1024*1024*1024
  
    // 혹은 테스트 용도로 더 작은 크기를 쓰고 싶다면 아래 값으로 대체:
    // const realSizeBytes = 100 * 1024 * 1024; // 100MB
  
    // 100개 파일을 모두 병렬로 생성
    const createFilePromises = [];
    for (let i = 0; i < LARGE_CSV_COUNT; i++) {
      const filename = `large_${i}.csv`;
      const filePath = path.join(LARGE_CSV_DIR, filename);
      createFilePromises.push(createLargeCsvFile(filePath, realSizeBytes));
    }
  
    await Promise.all(createFilePromises);
  }
  
  /**
   * 스트리밍 방식으로 파일에 `fileSizeBytes` 만큼 쓰는 함수
   * 1MB(=1024*1024) 버퍼를 계속 써서 최종 용량에 도달
   */
  async function createLargeCsvFile(filePath, fileSizeBytes) {
    return new Promise((resolve, reject) => {
      const CHUNK_SIZE = 1024 * 1024; // 1MB
      const writeStream = fs.createWriteStream(filePath);
  
      // 1MB 크기의 버퍼를 'X'로 채운 예시
      // 실제로는 CSV 형태로 데이터를 넣고 싶다면 이 부분을 적절히 변경하세요.
      const chunk = Buffer.alloc(CHUNK_SIZE, 'X');
  
      let written = 0;
  
      writeStream.on('error', reject);
      writeStream.on('close', resolve);
      writeStream.on('drain', writeMore);
  
      // 처음에 writeMore를 호출해 쓰기 시작
      writeMore();
  
      function writeMore() {
        while (written < fileSizeBytes) {
          // 남은 용량과 CHUNK_SIZE 중 작은 쪽만큼을 쓴다
          const bytesRemaining = fileSizeBytes - written;
          const bytesToWrite = Math.min(CHUNK_SIZE, bytesRemaining);
  
          // chunk 일부만 잘라서 쓰기
          const canContinue = writeStream.write(chunk.slice(0, bytesToWrite));
          written += bytesToWrite;
  
          // 스트림 내부 버퍼가 가득 차면 canContinue === false가 되어
          // 'drain' 이벤트 때까지 대기해야 함
          if (!canContinue) {
            return;
          }
        }
        // 여기 도달했다는 것은 더 이상 쓸 데이터가 없다는 뜻
        writeStream.end();
      }
    });
  }
// 5. 대용량 csv 파일 읽기 (스트리밍 방식)
async function step5() {
    const fileNames = await fs.readdir(LARGE_CSV_DIR);
  
    // 각 파일을 createReadStream()으로 읽고, 'data' 이벤트로 청크를 소모
    const readPromises = fileNames.map((file) => {
      const filePath = path.join(LARGE_CSV_DIR, file);
      return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath);
  
        stream.on('error', reject);
  
        // 'data' 이벤트가 발생할 때마다 청크가 전달되지만
        // 여기서는 단순 테스트를 위해 특별한 작업은 하지 않고 버퍼만 소비
        stream.on('data', () => {});
  
        // 스트림이 끝나면 resolve
        stream.on('end', () => {
          resolve();
        });
      });
    });
  
    // 모든 파일 읽기가 끝날 때까지 대기
    await Promise.all(readPromises);
  }
  

// 6. 대용량 db 파일 만들기 (5에서 사용한 파일 1기가짜리 10개 각각 다른 db 파일명으로 만들어서 저장)
async function step6() {
    await fs.ensureDir(DB_DIR);
  
    // LARGE_CSV_DIR에 있는 파일 목록을 가져오되, 상위 10개만 사용 (예: large_0.csv ~ large_9.csv)
    // 필요하다면 10 대신 100, 또는 다른 값으로 조정하세요.
    const fileNames = (await fs.readdir(LARGE_CSV_DIR)).slice(0, 10);
  
    for (const [index, file] of fileNames.entries()) {
      const filePath = path.join(LARGE_CSV_DIR, file);
  
      // 예: bigdata_0.sqlite, bigdata_1.sqlite, ...
      const dbFileName = `bigdata_${index}.sqlite`;
      const dbFilePath = path.join(DB_DIR, dbFileName);
  
      // DB 파일이 이미 있으면 삭제
      if (await fs.pathExists(dbFilePath)) {
        await fs.unlink(dbFilePath);
      }
  
      // 새 DB 생성
      const db = new sqlite3.Database(dbFilePath);
  
      // 테이블 생성 (chunk를 BLOB으로)
      await new Promise((resolve, reject) => {
        db.run(
          `CREATE TABLE IF NOT EXISTS file_chunks (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             chunk BLOB
           )`,
          (err) => (err ? reject(err) : resolve())
        );
      });
  
      // CSV 파일 내용을 스트리밍으로 읽어,
      // 1MB 단위씩 DB에 INSERT
      await insertFileAsChunks(db, filePath);
  
      // DB 닫기
      db.close();
      console.log(`[Step6] '${file}' → '${dbFileName}' 변환 완료`);
    }
  }
  
  /**
   * 주어진 filePath를 스트리밍으로 읽어,
   * 1MB 씩 잘라서 DB 테이블(file_chunks)에 INSERT
   */
  async function insertFileAsChunks(db, filePath) {
    return new Promise((resolve, reject) => {
      const CHUNK_SIZE = 1024 * 1024; // 1MB
      const readStream = fs.createReadStream(filePath, { highWaterMark: CHUNK_SIZE });
  
      readStream.on('error', (err) => reject(err));
  
      readStream.on('data', (chunk) => {
        // 스트림 중단 → DB INSERT → 완료 후 재개
        readStream.pause();
        db.run(
          `INSERT INTO file_chunks (chunk) VALUES (?)`,
          [chunk],
          (err) => {
            if (err) {
              reject(err);
            } else {
              // INSERT 끝나면 스트림 계속 진행
              readStream.resume();
            }
          }
        );
      });
  
      readStream.on('end', () => {
        // 모든 청크가 INSERT 되면 종료
        resolve();
      });
    });
  }
  
  
// 7. 대용량 db 파일 읽기 (6에서 만든 여러 DB를 순회하며 읽기) - 100번 반복
async function step7() {
    // step6에서 만든 DB 파일들
    const dbFiles = (await fs.readdir(DB_DIR))
      .filter((f) => f.endsWith('.sqlite')); // .sqlite 확장자만 필터링
  
    for (let round = 1; round <= 100; round++) {
      console.log(`[Step7] Round ${round} / 100 시작`);
  
      for (const dbFile of dbFiles) {
        const dbPath = path.join(DB_DIR, dbFile);
        const db = new sqlite3.Database(dbPath);
  
        // file_chunks 테이블에서 chunk 수를 세어본다
        await new Promise((resolve, reject) => {
          db.get('SELECT COUNT(*) as cnt FROM file_chunks', (err, row) => {
            if (err) return reject(err);
            // console.log(`[Step7 - Round ${round}] DB ${dbFile} => total chunks: ${row.cnt}`);
            resolve();
          });
        });
  
        db.close();
      }
  
      console.log(`[Step7] Round ${round} / 100 완료`);
    }
  }
  
// 8. 대용량 db 에서 임의 컬럼(랜덤 레코드) 조회
async function step8() {
    const dbFiles = (await fs.readdir(DB_DIR))
      .filter((f) => f.endsWith('.sqlite'));
  
    const randomQueries = 100; // DB마다 100회 랜덤 조회
  
    for (const dbFile of dbFiles) {
      const dbPath = path.join(DB_DIR, dbFile);
      const db = new sqlite3.Database(dbPath);
  
      // file_chunks 테이블의 행 개수를 구한다
      let rowCount = 0;
      await new Promise((resolve, reject) => {
        db.get(`SELECT COUNT(*) as cnt FROM file_chunks`, (err, row) => {
          if (err) return reject(err);
          rowCount = row.cnt;
          resolve();
        });
      });
  
      // rowCount가 0이라면(파일이 아주 작다면) 건너뜀
      if (rowCount === 0) {
        // console.log(`[Step8] DB ${dbFile} => no chunks`);
        db.close();
        continue;
      }
  
      // 10번 랜덤하게 chunk를 조회
      for (let i = 0; i < randomQueries; i++) {
        const randomId = Math.floor(Math.random() * rowCount) + 1;
        await new Promise((resolve, reject) => {
          db.get(`SELECT chunk FROM file_chunks WHERE id=?`, [randomId], (err, row) => {
            if (err) return reject(err);
            // row.chunk 에 실제 데이터가 들어있음 (여기서는 사용하지 않고 버림)
            resolve();
          });
        });
      }
  
      db.close();
      console.log(`[Step8] DB ${dbFile} => ${randomQueries} random queries 완료`);
    }
  }
  

// 9. 용량이 어느정도 찬 상태에서 1번수행 (1~8번 수행 후 SSD가 꽤 찼다고 가정)
async function step9() {
  // step1과 step2를 재실행하는 형태. 단, 쓰기 횟수 등은 임의로 조정해도 됨
  // 여기서는 STEP9_REPEAT_TIMES를 사용해서 예시
  console.log('[Step9] SSD가 어느 정도 찬 상태에서 소규모 쓰기 재테스트');
  
  // step1 변형 버전
  {
    const iteration = 5;
    let totalDuration = 0;
    for (let run = 1; run <= iteration; run++) {
      if (await fs.pathExists(SMALL_CSV_SINGLE_FILE)) {
        await fs.unlink(SMALL_CSV_SINGLE_FILE);
      }
      await fs.appendFile(SMALL_CSV_SINGLE_FILE, 'id,value\n');

      const startTime = performance.now();
      for (let i = 1; i <= STEP9_REPEAT_TIMES.step1Count; i++) {
        const row = `${i},value_${i}\n`;
        await fs.appendFile(SMALL_CSV_SINGLE_FILE, row);
      }
      const endTime = performance.now();
      totalDuration += (endTime - startTime);
    }
    const avgMs = totalDuration / iteration;
    console.log(`[Step9] Average Time: ${(avgMs / 1000).toFixed(3)}초`);
  }

  // step2 변형 버전
  {
    await fs.ensureDir(SMALL_FILES_DIR);
    const fileWritePromises = [];
    for (let i = 0; i < STEP9_REPEAT_TIMES.step2FileCount; i++) {
      const fileName = `small_retest_${i}.csv`;
      const filePath = path.join(SMALL_FILES_DIR, fileName);

      fileWritePromises.push((async () => {
        if (await fs.pathExists(filePath)) {
          await fs.unlink(filePath);
        }
        await fs.appendFile(filePath, 'id,value\n');
        for (let j = 1; j <= STEP9_REPEAT_TIMES.step2WritesPerFile; j++) {
          const row = `${j},value_${j}\n`;
          await fs.appendFile(filePath, row);
        }
      })());
    }
    await Promise.all(fileWritePromises);
  }
}

// 10. 용량이 어느정도 찬 상태에서 2번수행 (1~8번 수행 후 SSD가 꽤 찼다고 가정)
async function step10() {
    // step1과 step2를 재실행하는 형태. 단, 쓰기 횟수 등은 임의로 조정해도 됨
    // 여기서는 STEP9_REPEAT_TIMES를 사용해서 예시
    console.log('[Step10] SSD가 어느 정도 찬 상태에서 동시 쓰기 재테스트');
    


    {
      await fs.ensureDir(SMALL_FILES_DIR);
      const fileWritePromises = [];
      for (let i = 0; i < STEP9_REPEAT_TIMES.step2FileCount; i++) {
        const fileName = `small_retest_${i}.csv`;
        const filePath = path.join(SMALL_FILES_DIR, fileName);
  
        fileWritePromises.push((async () => {
          if (await fs.pathExists(filePath)) {
            await fs.unlink(filePath);
          }
          await fs.appendFile(filePath, 'id,value\n');
          for (let j = 1; j <= STEP9_REPEAT_TIMES.step2WritesPerFile; j++) {
            const row = `${j},value_${j}\n`;
            await fs.appendFile(filePath, row);
          }
        })());
      }
      await Promise.all(fileWritePromises);
    }
  }
  


// 새 함수
async function compressWithZipMultipleFiles(filePaths, outZip) {
    return new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outZip);
      const archive = archiver('zip', { zlib: { level: 9 } });
  
      archive.pipe(output);
      output.on('close', () => {
        console.log(`압축 완료: ${outZip} (${archive.pointer()} bytes)`);
        resolve();
      });
      archive.on('warning', (err) => {
        if (err.code === 'ENOENT') {
          console.warn('압축 경고:', err);
        } else {
          reject(err);
        }
      });
      archive.on('error', (err) => {
        reject(err);
      });
  
      for (const filePath of filePaths) {
        archive.file(filePath, { name: path.basename(filePath) });
      }
  
      archive.finalize();
    });
  }
  
  // 11. 2,4,6에서 만든 파일 각각 압축 (ZIP)
  async function step11() {
    await fs.ensureDir(COMPRESSION_OUTPUT_DIR);
  
    // 2번 small_files : 전체 디렉토리 압축
    {
      const outZip = path.join(COMPRESSION_OUTPUT_DIR, 'small_files.zip');
      if (await fs.pathExists(outZip)) {
        await fs.unlink(outZip);
      }
      await compressWithZip(SMALL_FILES_DIR, outZip);  // 기존 함수 그대로 사용
    }
  
    // 4번 large_csv : 앞의 5개 파일만 압축
    {
      const outZip = path.join(COMPRESSION_OUTPUT_DIR, 'large_csv_5.zip');
      if (await fs.pathExists(outZip)) {
        await fs.unlink(outZip);
      }
      const allLarge = await fs.readdir(LARGE_CSV_DIR);
      const firstFiveLarge = allLarge.slice(0, 5).map(f => path.join(LARGE_CSV_DIR, f));
      await compressWithZipMultipleFiles(firstFiveLarge, outZip);
    }
  
    // 6번 db_files : 앞의 5개 파일만 압축
    {
      const outZip = path.join(COMPRESSION_OUTPUT_DIR, 'db_files_5.zip');
      if (await fs.pathExists(outZip)) {
        await fs.unlink(outZip);
      }
      const allDb = await fs.readdir(DB_DIR);
      const firstFiveDb = allDb.slice(0, 5).map(f => path.join(DB_DIR, f));
      await compressWithZipMultipleFiles(firstFiveDb, outZip);
    }
  }
  
  

// 12. 1~10에서 작업한 데이터 삭제하는 시간
async function step12() {
  // test_data 폴더 전체 삭제 (주의!)
  // 실제로는 용도에 맞는 삭제 경로를 지정하시기 바랍니다.
  const testDataDir = path.join(__dirname, 'test_data');

  if (await fs.pathExists(testDataDir)) {
    await fs.remove(testDataDir);
  }
}

// =========================================================
// 메인 실행 시퀀스
// =========================================================
(async () => {
  try {
    // 1
    await measureAsync('Step1', step1);
    // 2
    await measureAsync('Step2', step2);
    // 3
    await measureAsync('Step3', step3);
    // 4
    await measureAsync('Step4', step4);
    // 5
    await measureAsync('Step5', step5);
    // 6
    await measureAsync('Step6', step6);
    // 7
    await measureAsync('Step7', step7);
    // 8
    await measureAsync('Step8', step8);
    // 9
    await measureAsync('Step9', step9);
    // 10
    await measureAsync('Step10', step10);
    // 11
    await measureAsync('Step11', step11);
    // 12
    await measureAsync('Step12', step12);

    console.log('\n===== 테스트 완료! 각 단계별 소요 시간(초) =====');
    for (const [stepName, timeSec] of Object.entries(results)) {
      console.log(`${stepName}: ${timeSec.toFixed(3)}초`);
    }
  } catch (err) {
    console.error('에러 발생:', err);
  }
})();
