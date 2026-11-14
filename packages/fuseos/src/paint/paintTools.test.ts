import { BRUSH_SIZES, PAINT_TOOLS, boxBetween, fileNameFor, floodFill, isFreehandTool, isPaintTool, isShapeTool, mimeTypeForName } from './paintTools';
import { WIN98_PALETTE, parseHexColor, toHexColor } from './palette';

describe('palette', () => {
  it('has the 28 Windows 98 colours with black first and white starting the second row', () => {
    expect(WIN98_PALETTE).toHaveLength(28);
    expect(new Set(WIN98_PALETTE).size).toBe(28);
    expect(WIN98_PALETTE[0]).toBe('#000000');
    expect(WIN98_PALETTE[14]).toBe('#ffffff');
  });

  it('parses hex colours and formats them back', () => {
    expect(parseHexColor('#ff8040')).toEqual([255, 128, 64, 255]);
    expect(parseHexColor('#fff')).toEqual([255, 255, 255, 255]);
    expect(parseHexColor('nope')).toEqual([0, 0, 0, 255]);
    expect(toHexColor(255, 128, 64)).toBe('#ff8040');
    expect(toHexColor(300, -5, 7.6)).toBe('#ff0008');
  });
});

describe('tools', () => {
  it('knows every tool and the brush sizes', () => {
    expect(PAINT_TOOLS.map((item) => item.tool)).toEqual(['pencil', 'brush', 'eraser', 'fill', 'picker', 'text', 'line', 'rect', 'filledRect', 'ellipse']);
    expect(BRUSH_SIZES).toEqual([2, 5, 8]);
    expect(isPaintTool('brush')).toBe(true);
    expect(isPaintTool('spray')).toBe(false);
    expect(isShapeTool('ellipse')).toBe(true);
    expect(isShapeTool('brush')).toBe(false);
    expect(isFreehandTool('eraser')).toBe(true);
    expect(isFreehandTool('line')).toBe(false);
  });

  it('normalises a dragged box regardless of direction', () => {
    expect(boxBetween({ x: 10, y: 20 }, { x: 4, y: 30 })).toEqual({ x: 4, y: 20, width: 6, height: 10 });
  });

  it('derives file names and mime types', () => {
    expect(fileNameFor(' sketch ', 'image/png')).toBe('sketch.png');
    expect(fileNameFor('sketch.PNG', 'image/jpeg')).toBe('sketch.jpg');
    expect(fileNameFor('', 'image/png')).toBe('untitled.png');
    expect(mimeTypeForName('a.JPG')).toBe('image/jpeg');
    expect(mimeTypeForName('a.png')).toBe('image/png');
    expect(mimeTypeForName('a')).toBe('image/png');
  });
});

describe(floodFill.name, () => {
  it('fills the connected region of the start colour only', () => {
    // Arrange: 4x3 image, white with a black vertical wall at x=2.
    const width = 4;
    const height = 3;
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < height; y += 1) {
      const i = (y * width + 2) * 4;
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
    }
    // Act
    const changed = floodFill(pixels, width, height, { x: 0.7, y: 1.2 }, [255, 0, 0, 255]);
    // Assert: left of the wall is red, the wall black, right of it white.
    expect(changed).toBe(true);
    const at = (x: number, y: number) => [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];
    expect(at(0, 0)).toEqual([255, 0, 0]);
    expect(at(1, 2)).toEqual([255, 0, 0]);
    expect(at(2, 1)).toEqual([0, 0, 0]);
    expect(at(3, 1)).toEqual([255, 255, 255]);
  });

  it('does nothing outside the image or when the colour is already there', () => {
    const pixels = new Uint8ClampedArray(2 * 2 * 4).fill(255);
    expect(floodFill(pixels, 2, 2, { x: 5, y: 0 }, [0, 0, 0, 255])).toBe(false);
    expect(floodFill(pixels, 2, 2, { x: 0, y: 0 }, [255, 255, 255, 255])).toBe(false);
    expect([...pixels].every((channel) => channel === 255)).toBe(true);
  });
});
