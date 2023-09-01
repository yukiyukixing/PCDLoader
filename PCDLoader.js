// 导入需要使用的 THREE.js 类和方法
import {
    BufferGeometry,
    Color,
    FileLoader,
    Float32BufferAttribute,
    Int32BufferAttribute,
    Loader,
    Points,
    PointsMaterial
} from 'three';

// PCDLoader 类继承了 THREE.js 的 Loader 类，
// 用于加载 PCD (Point Cloud Data) 格式的文件。
class PCDLoader extends Loader {

    constructor(manager) {
        // 调用父类构造函数
        super(manager);
        // 设置数据小端格式，默认为 true
        this.littleEndian = true;
    }

    // 加载方法
    load(url, onLoad, onProgress, onError) {

        const scope = this;
        // 创建文件加载器对象
        const loader = new FileLoader(scope.manager);
        // 设置各种参数
        loader.setPath(scope.path);
        loader.setResponseType('arraybuffer');
        loader.setRequestHeader(scope.requestHeader);
        loader.setWithCredentials(scope.withCredentials);
        // 开始加载文件
        loader.load(url, function (data) {

            try {
                // 解析数据
                onLoad(scope.parse(data));
            } catch (e) {
                // 错误处理
                if (onError) {

                    onError(e);

                } else {

                    console.error(e);

                }

                scope.manager.itemError(url);

            }

        }, onProgress, onError);

    }
    // 解析方法，解析 PCD 格式数据
    parse(data) {

        // 定义解压缩LZF的函数，接受压缩数据和解压缩后数据的长度
        function decompressLZF(inData, outLength) {
            // 获取输入数据的长度
            const inLength = inData.length;
            // 创建一个Uint8Array作为输出数据的缓冲区
            const outData = new Uint8Array(outLength);
            // 初始化输入和输出的指针
            let inPtr = 0;
            let outPtr = 0;
            // 初始化其他变量
            let ctrl;
            let len;
            let ref;
            // 主解压缩循环
            do {
                // 读取控制字节
                ctrl = inData[inPtr++];
                // 判断是否为字面量（非重复数据）
                if (ctrl < (1 << 5)) {
                    // 更新字面量长度
                    ctrl++;
                    // 检查输出缓冲区是否足够大
                    if (outPtr + ctrl > outLength) throw new Error('Output buffer is not large enough');
                    // 检查输入数据是否有效
                    if (inPtr + ctrl > inLength) throw new Error('Invalid compressed data');
                    // 复制字面量到输出缓冲区
                    do {
                        outData[outPtr++] = inData[inPtr++];
                    } while (--ctrl);
                } else { // 否则，处理重复数据
                    // 获取长度和引用偏移量
                    len = ctrl >> 5;
                    ref = outPtr - ((ctrl & 0x1f) << 8) - 1;
                    // 检查输入数据是否有效
                    if (inPtr >= inLength) throw new Error('Invalid compressed data');
                    // 检查长度是否需要一个额外的字节
                    if (len === 7) {
                        len += inData[inPtr++];
                        if (inPtr >= inLength) throw new Error('Invalid compressed data');
                    }
                    // 更新引用偏移量
                    ref -= inData[inPtr++];
                    // 检查输出缓冲区是否足够大
                    if (outPtr + len + 2 > outLength) throw new Error('Output buffer is not large enough');
                    // 检查引用偏移量是否有效
                    if (ref < 0) throw new Error('Invalid compressed data');
                    if (ref >= outPtr) throw new Error('Invalid compressed data');
                    // 从引用偏移量开始复制数据到输出缓冲区
                    do {
                        outData[outPtr++] = outData[ref++];
                    } while (--len + 2);
                }
            } while (inPtr < inLength); // 继续解压缩，直到输入数据被完全读取
            // 返回解压缩后的数据
            return outData;
        }

        // 定义 parseHeader 函数，接受点云数据（通常为文本）作为参数
        function parseHeader(data) {

            // 初始化一个空对象，用于存储解析后的头部信息
            const PCDheader = {};
            // 使用正则表达式找到“DATA”关键字出现的位置
            const result1 = data.search(/[\r\n]DATA\s(\S*)\s/i);
            // 从找到的位置开始，提取与“DATA”关键字关联的值
            const result2 = /[\r\n]DATA\s(\S*)\s/i.exec(data.slice(result1 - 1));
            // 存储与“DATA”关联的值
            PCDheader.data = result2[1];
            // 存储头部信息的总长度
            PCDheader.headerLen = result2[0].length + result1;
            // 截取并存储整个头部的字符串信息
            PCDheader.str = data.slice(0, PCDheader.headerLen);
            // 删除注释（以 '#' 开头的行）
            PCDheader.str = PCDheader.str.replace(/#.*/gi, '');
            // 使用正则表达式解析各种头部字段，并将它们存储在对象中
            // 解析版本、字段、大小、类型、数量、宽度、高度、视点和点数
            PCDheader.version = /VERSION (.*)/i.exec(PCDheader.str);
            PCDheader.fields = /FIELDS (.*)/i.exec(PCDheader.str);
            PCDheader.size = /SIZE (.*)/i.exec(PCDheader.str);
            PCDheader.type = /TYPE (.*)/i.exec(PCDheader.str);
            PCDheader.count = /COUNT (.*)/i.exec(PCDheader.str);
            PCDheader.width = /WIDTH (.*)/i.exec(PCDheader.str);
            PCDheader.height = /HEIGHT (.*)/i.exec(PCDheader.str);
            PCDheader.viewpoint = /VIEWPOINT (.*)/i.exec(PCDheader.str);
            PCDheader.points = /POINTS (.*)/i.exec(PCDheader.str);
            // 根据解析结果，进一步处理和存储字段值
            if (PCDheader.version !== null)
                PCDheader.version = parseFloat(PCDheader.version[1]);
            // 字段信息变成数组
            PCDheader.fields = (PCDheader.fields !== null) ? PCDheader.fields[1].split(' ') : [];
            // 类型信息变成数组
            if (PCDheader.type !== null)
                PCDheader.type = PCDheader.type[1].split(' ');
            // 宽度和高度转换为整数
            if (PCDheader.width !== null)
                PCDheader.width = parseInt(PCDheader.width[1]);
            if (PCDheader.height !== null)
                PCDheader.height = parseInt(PCDheader.height[1]);
            // 存储视点信息
            if (PCDheader.viewpoint !== null)
                PCDheader.viewpoint = PCDheader.viewpoint[1];
            // 点数转换为整数
            if (PCDheader.points !== null)
                PCDheader.points = parseInt(PCDheader.points[1], 10);
            // 如果点数是 null，则计算点数（宽度 * 高度） 
            if (PCDheader.points === null)
                PCDheader.points = PCDheader.width * PCDheader.height;
            // 处理“SIZE”和“COUNT”字段，将字符串信息转换为整数数组
            if (PCDheader.size !== null) {
                PCDheader.size = PCDheader.size[1].split(' ').map(function (x) {
                    return parseInt(x, 10);
                });
            }
            if (PCDheader.count !== null) {
                PCDheader.count = PCDheader.count[1].split(' ').map(function (x) {
                    return parseInt(x, 10);
                });
            } else {
                PCDheader.count = [];
                for (let i = 0, l = PCDheader.fields.length; i < l; i++) {
                    PCDheader.count.push(1);
                }
            }
            // 初始化一个偏移对象，用于存储每个字段在数据中的偏移位置
            PCDheader.offset = {};
            // 计算偏移和行大小（仅用于二进制数据）
            let sizeSum = 0;
            for (let i = 0, l = PCDheader.fields.length; i < l; i++) {
                if (PCDheader.data === 'ascii') {
                    PCDheader.offset[PCDheader.fields[i]] = i;
                } else {
                    PCDheader.offset[PCDheader.fields[i]] = sizeSum;
                    sizeSum += PCDheader.size[i] * PCDheader.count[i];
                }
            }
            // 仅用于二进制数据：存储一行数据的总字节数
            PCDheader.rowSize = sizeSum;
            // 返回解析后的头部信息对象
            return PCDheader;
        }

        // 使用 TextDecoder 解码数据流，用于将二进制数据转换为文本格式。
        const textData = new TextDecoder().decode(data);
        // 解析文件头（Header），这通常是 ASCII 格式的文本，
        // 用于描述点云数据的一些基础信息
        const PCDheader = parseHeader(textData);
        // 初始化点云的位置（coordinates）数组
        const position = [];
        // 初始化点云的法线（normals）数组
        const normal = [];
        // 初始化点云的颜色（colors）数组
        const color = [];
        // 初始化点云的强度（intensity）数组
        const intensity = [];
        // 初始化点云的标签（labels）数组
        const label = [];
        // 初始化颜色对象
        const c = new Color();

        // 解析点云头文件类型为 ASCII 的数据
        if (PCDheader.data === 'ascii') {
            // 获取字段偏移信息
            const offset = PCDheader.offset;
            // 去掉头部信息，只保留点云数据
            const pcdData = textData.slice(PCDheader.headerLen);
            // 按行切割数据
            const lines = pcdData.split('\n');
            // 遍历每一行数据
            for (let i = 0, l = lines.length; i < l; i++) {
                // 跳过空行
                if (lines[i] === '') continue;
                // 分割每一行的元素
                const line = lines[i].split(' ');
                // 如果存在 x, y, z 偏移，解析并存储位置信息
                if (offset.x !== undefined) {
                    position.push(parseFloat(line[offset.x]));
                    position.push(parseFloat(line[offset.y]));
                    position.push(parseFloat(line[offset.z]));
                }
                // 如果存在 RGB 偏移，解析并存储颜色信息
                if (offset.rgb !== undefined) {
                    // 查找 RGB 字段的类型
                    const rgb_field_index = PCDheader.fields.findIndex((field) => field === 'rgb');
                    const rgb_type = PCDheader.type[rgb_field_index];
                    // 解析 RGB 值
                    const float = parseFloat(line[offset.rgb]);
                    let rgb = float;
                    // 如果 RGB 类型为 'F'（浮点数），则将其转换为整数
                    if (rgb_type === 'F') {
                        const farr = new Float32Array(1);
                        farr[0] = float;
                        rgb = new Int32Array(farr.buffer)[0];
                    }
                    // 从 RGB 整数中提取 R, G, B 值，并转换为 [0,1] 范围
                    const r = ((rgb >> 16) & 0x0000ff) / 255;
                    const g = ((rgb >> 8) & 0x0000ff) / 255;
                    const b = ((rgb >> 0) & 0x0000ff) / 255;
                    // 转换颜色并存储
                    c.set(r, g, b).convertSRGBToLinear();
                    color.push(c.r, c.g, c.b);
                }
                // 如果存在法线信息，解析并存储
                if (offset.normal_x !== undefined) {
                    normal.push(parseFloat(line[offset.normal_x]));
                    normal.push(parseFloat(line[offset.normal_y]));
                    normal.push(parseFloat(line[offset.normal_z]));
                }
                // 如果存在光照强度信息，解析并存储
                if (offset.intensity !== undefined) {
                    intensity.push(parseFloat(line[offset.intensity]));
                }
                // 如果存在标签信息，解析并存储
                if (offset.label !== undefined) {
                    label.push(parseInt(line[offset.label]));
                }
            }
        }

        // 通常 PCD 文件中的数据被组织为结构数组：XYZRGBXYZRGB
        // 二进制压缩的 PCD 文件将其数据组织为数组结构： XXYYZZRGBRGB
        // 与非压缩数据相比，这需要完全不同的解析方法

        // 解析类型为 二进制压缩格式 的数据
        if (PCDheader.data === 'binary_compressed') {
            // 读取压缩和解压缩大小
            const sizes = new Uint32Array(data.slice(PCDheader.headerLen, PCDheader.headerLen + 8));
            const compressedSize = sizes[0];
            const decompressedSize = sizes[1];
            // 进行LZF解压缩
            const decompressed = decompressLZF(new Uint8Array(data, PCDheader.headerLen + 8, compressedSize), decompressedSize);
            // 创建一个DataView对象以读取解压后的二进制数据
            const dataview = new DataView(decompressed.buffer);
            // 获取每个字段（比如x, y, z, rgb等）在数据中的偏移量
            const offset = PCDheader.offset;
            // 遍历所有点
            for (let i = 0; i < PCDheader.points; i++) {
                // 如果存在x字段
                if (offset.x !== undefined) {
                    // 寻找x, y, z字段在字段列表中的索引
                    const xIndex = PCDheader.fields.indexOf('x');
                    const yIndex = PCDheader.fields.indexOf('y');
                    const zIndex = PCDheader.fields.indexOf('z');
                    // 读取并存储x, y, z坐标
                    position.push(dataview.getFloat32((PCDheader.points * offset.x) + PCDheader.size[xIndex] * i, this.littleEndian));
                    position.push(dataview.getFloat32((PCDheader.points * offset.y) + PCDheader.size[yIndex] * i, this.littleEndian));
                    position.push(dataview.getFloat32((PCDheader.points * offset.z) + PCDheader.size[zIndex] * i, this.littleEndian));
                }
                // 如果存在rgb字段
                if (offset.rgb !== undefined) {
                    // 寻找rgb字段在字段列表中的索引
                    const rgbIndex = PCDheader.fields.indexOf('rgb');
                    // 读取并存储r, g, b颜色值
                    const r = dataview.getUint8((PCDheader.points * offset.rgb) + PCDheader.size[rgbIndex] * i + 2) / 255.0;
                    const g = dataview.getUint8((PCDheader.points * offset.rgb) + PCDheader.size[rgbIndex] * i + 1) / 255.0;
                    const b = dataview.getUint8((PCDheader.points * offset.rgb) + PCDheader.size[rgbIndex] * i + 0) / 255.0;
                    // 将sRGB颜色转换为线性颜色
                    c.set(r, g, b).convertSRGBToLinear();
                    // 存储颜色
                    color.push(c.r, c.g, c.b);
                }
                // 如果存在normal_x字段
                if (offset.normal_x !== undefined) {
                    // 寻找normal_x, normal_y, normal_z字段在字段列表中的索引
                    const xIndex = PCDheader.fields.indexOf('normal_x');
                    const yIndex = PCDheader.fields.indexOf('normal_y');
                    const zIndex = PCDheader.fields.indexOf('normal_z');
                    // 读取并存储法线信息
                    normal.push(dataview.getFloat32((PCDheader.points * offset.normal_x) + PCDheader.size[xIndex] * i, this.littleEndian));
                    normal.push(dataview.getFloat32((PCDheader.points * offset.normal_y) + PCDheader.size[yIndex] * i, this.littleEndian));
                    normal.push(dataview.getFloat32((PCDheader.points * offset.normal_z) + PCDheader.size[zIndex] * i, this.littleEndian));
                }
                // 如果存在intensity字段
                if (offset.intensity !== undefined) {
                    // 寻找intensity字段在字段列表中的索引
                    const intensityIndex = PCDheader.fields.indexOf('intensity');
                    // 读取并存储光强值
                    intensity.push(dataview.getFloat32((PCDheader.points * offset.intensity) + PCDheader.size[intensityIndex] * i, this.littleEndian));
                }
                // 如果存在label字段
                if (offset.label !== undefined) {
                    // 寻找label字段在字段列表中的索引
                    const labelIndex = PCDheader.fields.indexOf('label');
                    // 读取并存储标签值
                    label.push(dataview.getInt32((PCDheader.points * offset.label) + PCDheader.size[labelIndex] * i, this.littleEndian));
                }
            }
        }

        // 解析类型为 二进制格式 的数据
        if (PCDheader.data === 'binary') {
            // 创建一个DataView对象以便更容易地访问二进制数据
            const dataview = new DataView(data, PCDheader.headerLen);
            // 获取点云数据字段的偏移量
            const offset = PCDheader.offset;
            // 遍历所有点
            for (let i = 0, row = 0; i < PCDheader.points; i++, row += PCDheader.rowSize) {
                // 如果数据中包含x、y、z坐标
                if (offset.x !== undefined) {
                    // 读取并存储x、y、z坐标
                    position.push(dataview.getFloat32(row + offset.x, this.littleEndian));
                    position.push(dataview.getFloat32(row + offset.y, this.littleEndian));
                    position.push(dataview.getFloat32(row + offset.z, this.littleEndian));
                }
                // 如果数据中包含RGB颜色信息
                if (offset.rgb !== undefined) {
                    // 读取并存储RGB值，然后将其转换为线性空间
                    const r = dataview.getUint8(row + offset.rgb + 2) / 255.0;
                    const g = dataview.getUint8(row + offset.rgb + 1) / 255.0;
                    const b = dataview.getUint8(row + offset.rgb + 0) / 255.0;
                    c.set(r, g, b).convertSRGBToLinear();
                    color.push(c.r, c.g, c.b);
                }
                // 如果数据中包含法线信息
                if (offset.normal_x !== undefined) {
                    // 读取并存储法线向量
                    normal.push(dataview.getFloat32(row + offset.normal_x, this.littleEndian));
                    normal.push(dataview.getFloat32(row + offset.normal_y, this.littleEndian));
                    normal.push(dataview.getFloat32(row + offset.normal_z, this.littleEndian));
                }
                // 如果数据中包含光照强度信息
                if (offset.intensity !== undefined) {
                    // 读取并存储光照强度
                    intensity.push(dataview.getFloat32(row + offset.intensity, this.littleEndian));
                }
                // 如果数据中包含标签信息
                if (offset.label !== undefined) {
                    // 读取并存储标签
                    label.push(dataview.getInt32(row + offset.label, this.littleEndian));
                }
            }
        }

        // 构建几何体

        // 创建一个新的缓冲几何体（BufferGeometry对象）
        const geometry = new BufferGeometry();
        // 如果位置数组非空，将其作为点的位置属性添加到几何体中
        if (position.length > 0) geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
        // 如果法线数组非空，将其作为点的法线属性添加到几何体中
        if (normal.length > 0) geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
        // 如果颜色数组非空，将其作为点的颜色属性添加到几何体中
        if (color.length > 0) geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
        // 如果光照强度数组非空，将其作为点的光照强度属性添加到几何体中
        if (intensity.length > 0) geometry.setAttribute('intensity', new Float32BufferAttribute(intensity, 1));
        // 如果标签数组非空，将其作为点的标签属性添加到几何体中
        if (label.length > 0) geometry.setAttribute('label', new Int32BufferAttribute(label, 1));
        // 计算几何体的边界球，用于进行一些优化和碰撞检测等操作
        geometry.computeBoundingSphere();
        // 构建材质，设置点的大小为0.005
        const material = new PointsMaterial({ size: 0.005 });
        // 如果颜色数组非空，则设置顶点颜色为true，这样点将使用顶点颜色数组中的颜色
        if (color.length > 0) {
            material.vertexColors = true;
        }
        // 构建点云对象并返回
        return new Points(geometry, material);
    }
}
export { PCDLoader };
