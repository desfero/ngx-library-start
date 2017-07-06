import { Component } from '@angular/core';

@Component({
  selector: 'my-lib',
  templateUrl: './lib.component.html',
  styleUrls: ['./lib.component.less']
})
export class LibComponent {
  name = 'Angular Library';
}
