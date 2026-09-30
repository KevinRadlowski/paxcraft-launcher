import { Pipe, PipeTransform } from '@angular/core';
import { translate } from './messages';

@Pipe({
  name: 'scTranslate',
  standalone: true,
  pure: true,
})
export class ScTranslatePipe implements PipeTransform {
  transform(key: string, params?: Record<string, string | number>): string {
    return translate(key, params);
  }
}
