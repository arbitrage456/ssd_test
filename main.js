const fs = require('fs-extra');
const path = require('path');

// CSV 파일 경로 설정
const filePath = path.join(__dirname, 'output.csv');

(async () => {
    let totalDuration = 0;

    for (let run = 1; run <= 5; run++) {
        // 디렉토리 생성
        await fs.ensureDir(path.dirname(filePath));

        // 기존 파일이 있으면 삭제
        if (await fs.pathExists(filePath)) {
            await fs.unlink(filePath);
        }

        // 헤더 추가
        const header = 'id,value\n';
        await fs.appendFile(filePath, header);

        console.time(`Run ${run} Time`);
        const startTime = Date.now();

        // 50,000번 데이터 추가
        for (let i = 1; i <= 50000; i++) {
            const row = `${i},value_${i}\n`;
            await fs.appendFile(filePath, row);
        }

        const endTime = Date.now();
        const duration = endTime - startTime;
        totalDuration += duration;

        console.timeEnd(`Run ${run} Time`);
    }

    const averageTime = totalDuration / 5;
    console.log(`Average CSV Append Time: ${averageTime}ms`);
})();