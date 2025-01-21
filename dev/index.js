import process from 'node:process';
import path from 'node:path';
import { createReadStream, openAsBlob, readFileSync, rmSync } from 'node:fs';
import { ChildProcess, exec, execSync, spawn } from 'node:child_process';
import { zip } from 'compressing';
import { networkInterfaces } from 'node:os';
import { diffString } from 'json-diff';

export const mainmainmain = (cwd, argv) => {
    const behavior = argv[2];
    const condomjson = JSON.parse(readFileSync(path.join(cwd, 'condom.json')));
    const Omitted = Symbol("omitted");
    const processRes = (res) => {
        if (typeof res == 'object') {
            return Object.fromEntries(Object.entries(res).map(i => {
                if(i[0].startsWith("OMIT:")){
                    return [i[0].slice(5), Omitted];
                }else{
                    return [i[0], processRes(i[1])];
                }
            }));
        } else {
            if (typeof res == 'string' && res.startsWith('OMIT:')) {
                return Omitted;
            }
            return res;
        }
    }
    const deepEqual = (a, b) => {
        if (typeof a == 'object' && typeof b == 'object') {
            let set = new Set();
            for (let i of Object.keys(a)) { set.add(i); }
            for (let i of Object.keys(b)) { set.add(i); }
            return [...set].every(i => deepEqual(a[i], b[i]));
        } else {
            return a == b || a == Omitted || b == Omitted;
        }
    }
    const zeroRegex = /(?:[0]{1,2}[:-]){5}[0]{1,2}/;
    const getMac = (iface) => {
        const list = networkInterfaces();
        if (iface) {
            const parts = list[iface];
            if (!parts) {
                throw new Error(`interface ${iface} was not found`);
            }
            for (const part of parts) {
                if (zeroRegex.test(part.mac) === false) {
                    return part.mac;
                }
            }
            throw new Error(`interface ${iface} had no valid mac addresses`);
        } else {
            for (const [key, parts] of Object.entries(list)) {
                if (!parts)
                    continue;
                for (const part of parts) {
                    if (zeroRegex.test(part.mac) === false) {
                        return part.mac;
                    }
                }
            }
        }
        throw new Error("failed to get the MAC address");
    }
    const test = async (specify) => {
        let testFiles = Object.entries(condomjson.tests).filter(i => i[1]).map(i => JSON.parse(readFileSync(i[0], 'utf-8')));
        if (specify != null) {
            testFiles = JSON.parse(readFileSync(specify, 'utf-8'));
        }
        console.log("-开始测试");
        let p = exec(condomjson.scripts.start, { cwd: cwd, });
        p.stdout.on('data', (data) => {
            console.log(data.toString());
        });
        let succeeded = 0;

        await new Promise((resolve, reject) => {
            let timeout=setTimeout(() => {
                reject("难以连接服务器。");
                clearInterval(intv);
            }, 5000);
            let intv=setInterval(() => {
                fetch(`http://localhost:${condomjson.port}`).then(res => {
                    if (res.status == 200)
                        res.text().then(res => {
                            clearTimeout(timeout);
                            clearInterval(intv);
                            resolve(res);
                        });
                }).catch(err => {
                });
            }, 1000);

        });
        console.log("-服务已启动");
        for (let i of testFiles) {
            if (typeof i.req.body == 'object') {
                i.req.body = JSON.stringify(i.req.body);
            };
            let res = await fetch(`http://localhost:${condomjson.port}` + i.req.url, i.req);
            let body = await res.json();
            let ires = processRes(i.res);
            if (ires.status == null && res.status == 200 || ires.status == res.status || ires.status == Omitted) {
                try {
                    if (deepEqual(ires.body, body)) {
                        console.log(`--✅${i.req.url} 测试成功`);
                        succeeded++;
                    } else {
                        console.log(`--😭${i.req.url} 响应测试失败:`, diffString(ires.body, body));
                    }
                } catch (e) {
                    console.log(`--😭${i.req.url} JSON测试失败:`, body);
                }
            } else {
                console.log(`--😭${i.req.url} 状态测试失败:`, body);
            }
        }
        p.kill();
        console.log(`-测试完毕，${succeeded}/${testFiles.length} 成功`);
        return !(testFiles.length - succeeded);
    }

    const upload = async (zipfile) => {
        let body = new FormData();
        body.append('projectName', condomjson.projectName);
        body.append('mac', getMac());
        body.append('file', await openAsBlob(zipfile), zipfile);
        let res = await fetch(condomjson.remoteAddress, {
            method: 'POST',
            body: body,
        })
        let resbody = await res.json();
        if (res.status == 200 && resbody.code == 1) {
            console.log("-上传成功✅");
        } else {
            console.log("-上传失败❎", await res.text());
        }
    }

    const main = async () => {
        switch (behavior) {
            case 'test':
                await test(argv[3]);
                break;
            case 'build':
                if (!await test(null)) {
                    return;
                }
                console.log("-正在打包");
                execSync(`${condomjson.scripts.package}`);
                console.log("-正在压缩");
                let name = `dist_${new Date().getTime()}.zip`
                await zip.compressDir(path.join(cwd, condomjson.destinationFolder), path.join(cwd, name), { ignoreBase: true });
                console.log("-正在上传");
                await upload(name);
                rmSync(name);
                console.log("-完成");
                break;
        }
    }




    main().finally(() => { process.exit(0); });
}